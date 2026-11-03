import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commandFrom } from '../src/args.ts'
import { clipboardCommands, codeBlocks, lastAnswerIn, pickCopy, toClipboard, pickSave, suggestedCommand } from '../src/copy.ts'

const answer = 'Install it:\n\n```sh\nnpm i -g neoai\n```\n\nThen:\n\n~~~\nnavi setup\nnavi\n~~~\n'

// CLI-19, CLI-31
test('/copy is a command, and takes the answer, its last code block or its n-th', () => {
  assert.deepEqual(commandFrom('/copy'), { name: 'copy', args: '' })
  assert.deepEqual(commandFrom('/copy code 2'), { name: 'copy', args: 'code 2' })
  assert.equal(commandFrom('/copyright law'), null)
  assert.deepEqual(codeBlocks(answer), ['npm i -g neoai', 'navi setup\nnavi'])
  assert.deepEqual(pickCopy(answer, ''), { text: answer, said: 'copied the answer (12 lines)' })
  assert.deepEqual(pickCopy(answer, 'code'), { text: 'navi setup\nnavi', said: 'copied code block 2 of 2 (2 lines)' })
  assert.deepEqual(pickCopy(answer, 'code 1'), { text: 'npm i -g neoai', said: 'copied code block 1 of 2 (1 line)' })
  assert.deepEqual(pickCopy('```\nls\n```', 'code'), { text: 'ls', said: 'copied the code block (1 line)' })
  assert.match((pickCopy(answer, 'code 3') as { problem: string }).problem, /has 2 code blocks/)
  assert.match((pickCopy('Just words.', 'code') as { problem: string }).problem, /no code block/)
  assert.match((pickCopy(undefined, '') as { problem: string }).problem, /no answer to copy yet/)
  for (const bad of ['all', 'code 0', 'code x', 'code 1 2']) assert.match((pickCopy(answer, bad) as { problem: string }).problem, /^usage: \/copy/, bad)
})

test('a code block holding a shorter fence is kept whole', () => {
  assert.deepEqual(codeBlocks('````md\n```js\nx\n```\n````'), ['```js\nx\n```'])
})

// CLI-31
test('the last answer of a resumed conversation is its last assistant text', () => {
  assert.equal(
    lastAnswerIn([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'text', text: 'Hello.' }, { type: 'tool-call' }] },
      { role: 'tool', content: [] },
      { role: 'assistant', content: [{ type: 'text', text: 'Done: ' }, { type: 'text', text: 'it works.' }] },
      { role: 'user', content: '(navi: the files were put back)' },
    ]),
    'Done: it works.',
  )
  assert.equal(lastAnswerIn([{ role: 'user', content: 'hi' }]), undefined)
})

// CLI-32
test('the system clipboard, or over SSH the terminal’s through OSC 52', async () => {
  assert.deepEqual(clipboardCommands('darwin'), [['pbcopy']])
  assert.deepEqual(clipboardCommands('linux')[0], ['wl-copy'])
  const tried: string[] = []
  const run = async (c: string[]) => (tried.push(c[0]), c[0] === 'xclip')
  assert.equal(await toClipboard('x', { env: {}, platform: 'linux', run }), undefined)
  assert.deepEqual(tried, ['wl-copy', 'xclip'])
  assert.match((await toClipboard('x', { env: {}, platform: 'linux', run: async () => false }))!, /No clipboard was found/)
  let wrote = ''
  assert.equal(await toClipboard('héllo', { env: { SSH_CONNECTION: '1 2 3 4' }, write: (s) => (wrote += s), run: async () => assert.fail('not over SSH') }), undefined)
  assert.equal(wrote, `\x1b]52;c;${Buffer.from('héllo').toString('base64')}\x07`)
})

// CLI-32: the text goes in on the command's standard input; a stand-in pbcopy, so the real clipboard is left alone.
test('the clipboard command is given the text', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'navi-copy-'))
  const out = join(dir, 'got')
  await writeFile(join(dir, 'pbcopy'), `#!/bin/sh\ncat > '${out}'\n`)
  await chmod(join(dir, 'pbcopy'), 0o755)
  const path = process.env.PATH
  process.env.PATH = `${dir}:${path}`
  try {
    assert.equal(await toClipboard('du -h .\n', { env: {}, platform: 'darwin' }), undefined)
  } finally {
    process.env.PATH = path
  }
  assert.equal(await readFile(out, 'utf8'), 'du -h .\n')
  // None on the PATH at all.
  process.env.PATH = join(dir, 'nothing-here')
  try {
    assert.match((await toClipboard('x', { env: {}, platform: 'linux' }))!, /No clipboard/)
  } finally {
    process.env.PATH = path
  }
})

// CLI-36
test('pickSave takes what /copy would, a path after it, and ends with one newline', () => {
  const answer = 'Run:\n\n```sh\nnpm test\n```\n\nthen\n\n```\nnpm run build\n```'
  assert.deepEqual(pickSave(answer, 'notes.md'), { text: `${answer}\n`, path: 'notes.md', said: 'saved the answer (11 lines)' })
  assert.deepEqual(pickSave(answer, 'code run.sh'), { text: 'npm run build\n', path: 'run.sh', said: 'saved code block 2 of 2 (1 line)' })
  assert.deepEqual(pickSave(answer, "code 1 '/tmp/my file.sh'"), { text: 'npm test\n', path: '/tmp/my file.sh', said: 'saved code block 1 of 2 (1 line)' })
  assert.deepEqual(pickSave(answer, '~/My\\ Notes.md'), { text: `${answer}\n`, path: '~/My Notes.md', said: 'saved the answer (11 lines)' })
  assert.match((pickSave(answer, '') as any).problem, /^usage: \/save <file>/)
  assert.match((pickSave(answer, 'code') as any).problem, /^usage/)
  assert.match((pickSave(answer, 'code 3 x.sh') as any).problem, /has 2 code blocks/)
  assert.equal((pickSave(undefined, 'x.md') as any).problem, 'There is no answer to save yet.')
  assert.match((pickSave('no code', 'code x.sh') as any).problem, /\/save <file> saves all of it/)
})

// CLI-41
test('the command for the shell is the last code block, when it is shell and one line', () => {
  assert.equal(suggestedCommand('Run:\n\n```bash\n$ lsof -i :3000\n```'), 'lsof -i :3000')
  assert.equal(suggestedCommand('```\ngit status\n```\nor\n```console\ngit log -1\n```'), 'git log -1')
  assert.equal(suggestedCommand('```Shell\n  ls -la  \n\n```'), 'ls -la')
  // Not a shell block, not one line, a comment, or no block at all.
  assert.equal(suggestedCommand('```python\nprint(1)\n```'), undefined)
  assert.equal(suggestedCommand('```sh\ncd x\nmake\n```'), undefined)
  assert.equal(suggestedCommand('```sh\n# nothing to run\n```'), undefined)
  assert.equal(suggestedCommand('Just use ls.'), undefined)
  // The last block decides, even when an earlier one is shell.
  assert.equal(suggestedCommand('```sh\nls\n```\n```json\n{}\n```'), undefined)
})
