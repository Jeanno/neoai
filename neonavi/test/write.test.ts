import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeTools, type Gate } from '../src/tools.ts'
import { diffLines, summarize, type FileChange } from '../src/diff.ts'

type Asked = FileChange & { inside: boolean }

async function setup(answer = true, files: Record<string, string> = { 'a.txt': 'one\ntwo\nthree\n' }) {
  const cwd = await mkdtemp(join(tmpdir(), 'navi-w-'))
  for (const [name, text] of Object.entries(files)) await writeFile(join(cwd, name), text)
  const asked: Asked[] = []
  const gate: Gate = { approve: async () => true, change: async (c) => (asked.push(c), answer) }
  const tools = makeTools(gate, { cwd, web: false })
  const call = (name: 'write_file' | 'edit_file', input: any) =>
    (tools[name].execute as any)(input, { toolCallId: 't', messages: [] }) as Promise<string>
  const read = (name: string) => readFile(join(cwd, name), 'utf8')
  return { cwd, asked, call, read }
}

// TL-38
test('a diff marks the changed lines with three unchanged ones around them', () => {
  const before = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].join('\n') + '\n'
  const after = before.replace('5\n', 'five\nand more\n')
  const d = diffLines(before, after)
  assert.equal(d.diff, '@@ line 5 @@\n  2\n  3\n  4\n- 5\n+ five\n+ and more\n  6\n  7\n  8')
  assert.equal(d.added, 2)
  assert.equal(d.removed, 1)
  assert.deepEqual(diffLines('', 'a\nb\n'), { diff: '@@ line 1 @@\n+ a\n+ b', added: 2, removed: 0 })
})

// TL-38: what is approved is all of what is shown.
test('a long diff is shown whole, with control characters made visible', () => {
  const d = diffLines('', Array.from({ length: 200 }, (_, i) => `l${i}`).join('\n'))
  assert.equal(d.diff.split('\n').length, 201)
  assert.equal(d.added, 200)
  assert.equal(diffLines('', 'ok\x1b[1A\x1b[2K\rgone\tx\n').diff, '@@ line 1 @@\n+ ok␛[1A␛[2K␍gone\tx')
  assert.equal(diffLines('a', 'a\n').diff, '(only the newline at the end of the file changes)')
})

test('a change sums itself up in one line', () => {
  assert.equal(summarize({ path: 'a.ts', created: false, diff: '', added: 2, removed: 1 }), 'edit a.ts (+2 -1)')
  assert.equal(summarize({ path: 'n.md', created: true, diff: '', added: 12, removed: 0 }), 'create n.md (+12)')
})

// TL-36, TL-38, TL-39
test('write_file creates a file and its directories once approved', async () => {
  const w = await setup()
  const out = await w.call('write_file', { path: 'notes/today.md', content: 'hi\n' })
  assert.equal(out, 'created notes/today.md: +1 -0 lines')
  assert.equal(await w.read('notes/today.md'), 'hi\n')
  assert.equal(w.asked[0].created, true)
  assert.equal(w.asked[0].inside, true)
})

test('write_file replaces a file whole, and the change shows what goes', async () => {
  const w = await setup()
  await w.call('write_file', { path: 'a.txt', content: 'one\n2\nthree\n' })
  assert.equal(w.asked[0].created, false)
  assert.match(w.asked[0].diff, /- two\n\+ 2/)
  assert.equal(await w.read('a.txt'), 'one\n2\nthree\n')
})

test('a path outside the working directory is marked so', async () => {
  const w = await setup()
  const elsewhere = await mkdtemp(join(tmpdir(), 'navi-elsewhere-'))
  await w.call('write_file', { path: join(elsewhere, 'x.txt'), content: 'x' })
  // A unique name next to the working directory, so an earlier run's file cannot match.
  await w.call('write_file', { path: `../${w.cwd.split('/').pop()}-x.txt`, content: 'x' })
  assert.deepEqual(w.asked.map((c) => c.inside), [false, false])
})

// TL-38: a symbolic link can lead out of the working directory however the path reads.
test('a path through a symbolic link that leads out counts as outside', async () => {
  const w = await setup()
  const elsewhere = await mkdtemp(join(tmpdir(), 'navi-elsewhere-'))
  await symlink(elsewhere, join(w.cwd, 'link'))
  await symlink(join(elsewhere, 'dangling.txt'), join(w.cwd, 'note.txt'))
  await mkdir(join(w.cwd, 'sub'))
  await symlink(join(w.cwd, 'sub'), join(w.cwd, 'here'))
  await w.call('write_file', { path: 'link/evil.sh', content: 'x' })
  await w.call('write_file', { path: 'note.txt', content: 'x' })
  await w.call('write_file', { path: 'here/fine.txt', content: 'x' })
  assert.deepEqual(w.asked.map((c) => [c.path, c.inside]), [['link/evil.sh', false], ['note.txt', false], ['here/fine.txt', true]])
})

// TL-38: approval can take minutes.
test('a file changed while the question was open is not overwritten', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'navi-w-'))
  await writeFile(join(cwd, 'a.txt'), 'one\n')
  const gate: Gate = {
    approve: async () => true,
    change: async (c) => {
      await writeFile(join(cwd, c.path), 'the user was here\n')
      return true
    },
  }
  const tools = makeTools(gate, { cwd, web: false })
  const call = (name: 'write_file' | 'edit_file', input: any) => (tools[name].execute as any)(input, { toolCallId: 't', messages: [] })
  assert.match(await call('edit_file', { path: 'a.txt', old_text: 'one', new_text: '1' }), /a\.txt changed since it was read; nothing was written/)
  assert.match(await call('write_file', { path: 'b.txt', content: 'model\n' }), /b\.txt (changed|appeared) since it was read; nothing was written/)
  assert.equal(await readFile(join(cwd, 'a.txt'), 'utf8'), 'the user was here\n')
  assert.equal(await readFile(join(cwd, 'b.txt'), 'utf8'), 'the user was here\n')
})

// TL-39
test('a declined change is not made, and the model is told not to retry', async () => {
  const w = await setup(false)
  const out = await w.call('edit_file', { path: 'a.txt', old_text: 'two', new_text: '2' })
  assert.match(out, /declined to edit a\.txt \(\+1 -1\)\. Do not retry/)
  assert.equal(await w.read('a.txt'), 'one\ntwo\nthree\n')
})

test('with no way to ask, every change declines', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'navi-w-'))
  const tools = makeTools({ approve: async () => true }, { cwd, web: false })
  const out = await (tools.write_file.execute as any)({ path: 'n.txt', content: 'x' }, { toolCallId: 't', messages: [] })
  assert.match(out, /declined/)
  await assert.rejects(readFile(join(cwd, 'n.txt')))
})

// TL-37
test('edit_file replaces text that occurs once', async () => {
  const w = await setup()
  const out = await w.call('edit_file', { path: 'a.txt', old_text: 'two\n', new_text: 'two and $& a half\n' })
  assert.equal(out, 'edited a.txt: +1 -1 lines')
  assert.equal(await w.read('a.txt'), 'one\ntwo and $& a half\nthree\n')
})

test('edit_file says what is wrong and changes nothing', async () => {
  const w = await setup(true, { 'a.txt': 'x\nx\n' })
  assert.match(await w.call('edit_file', { path: 'a.txt', old_text: 'y', new_text: 'z' }), /not found in a\.txt/)
  assert.match(await w.call('edit_file', { path: 'a.txt', old_text: 'x', new_text: 'z' }), /occurs 2 times.*more surrounding lines/)
  assert.match(await w.call('edit_file', { path: 'gone.txt', old_text: 'x', new_text: 'z' }), /does not exist; use write_file/)
  assert.match(await w.call('edit_file', { path: 'a.txt', old_text: '', new_text: 'z' }), /old_text is empty/)
  assert.equal(w.asked.length, 0)
  assert.equal(await w.read('a.txt'), 'x\nx\n')
})

test('a change to the same text asks nothing', async () => {
  const w = await setup()
  assert.match(await w.call('write_file', { path: 'a.txt', content: 'one\ntwo\nthree\n' }), /nothing changed/)
  assert.equal(w.asked.length, 0)
})

// TL-40
test('"write": false removes both tools', () => {
  const tools = makeTools({ approve: async () => true }, { write: false, web: false })
  assert.ok(!('write_file' in tools) && !('edit_file' in tools))
})

// PRM-11
test('the prompt steers file changes to the file tools only when they are there', async () => {
  const { systemPrompt } = await import('../src/args.ts')
  assert.match(systemPrompt('/x', [], '', false, false, true), /edit_file[^]*write_file[^]*never run_shell[^]*do not retry/)
  assert.doesNotMatch(systemPrompt('/x', [], '', false, false, false), /edit_file/)
})
