import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addFact, checkFact, forgetFact, MAX_MEMORY, memoryFile, memorySection, projectRoot, readMemory } from '../src/memory.ts'
import { makeTools } from '../src/tools.ts'

const home = () => mkdtemp(join(tmpdir(), 'navi-mem-'))

// MEM-1
test('facts are read one per line, dashes or not, blank lines skipped', async () => {
  const h = await home()
  await mkdir(join(h, '.neoai'))
  await writeFile(memoryFile(h), '- Prefers metric units\n\n* Uses zsh\nWorks on neoai\n')
  assert.deepEqual(await readMemory(h), ['Prefers metric units', 'Uses zsh', 'Works on neoai'])
  assert.deepEqual(await readMemory(await home()), [])
})

// MEM-1
test('adding writes the whole file, private to the user', async () => {
  const h = await home()
  assert.equal(await addFact(h, '  Prefers metric units '), undefined)
  assert.equal(await addFact(h, 'Uses zsh'), undefined)
  assert.equal(await readFile(memoryFile(h), 'utf8'), '- Prefers metric units\n- Uses zsh\n')
  assert.equal((await stat(memoryFile(h))).mode & 0o777, 0o600)
})

// MEM-6
test('blank, multi-line, hidden, long, duplicate and overflowing facts are refused', () => {
  assert.match(checkFact('  ', []) ?? '', /empty/)
  assert.match(checkFact('one\ntwo', []) ?? '', /one line/)
  assert.match(checkFact('sneaky‮txt', []) ?? '', /invisible/)
  assert.match(checkFact('x'.repeat(301), []) ?? '', /300/)
  assert.match(checkFact('uses  ZSH', ['Uses zsh']) ?? '', /already/)
  const full = Array.from({ length: 20 }, (_, i) => `${i} ${'y'.repeat(200)}`)
  assert.match(checkFact('one more', full) ?? '', /full/)
  assert.equal(checkFact('Prefers metric units', ['Uses zsh']), undefined)
})

// MEM-2, MEM-3
test('the prompt section says where the facts came from, and is cut at the limit', () => {
  assert.equal(memorySection([]), '')
  assert.match(memorySection(['Uses zsh']), /\nWhat you remember about the user \(they wrote or approved each line[^\n]*\n- Uses zsh$/)
  const long = memorySection(Array.from({ length: 30 }, () => 'z'.repeat(200)))
  assert.ok(long.endsWith('…[memory truncated]'))
  assert.ok(long.length < MAX_MEMORY + 200)
})

// MEM-11
test('forget takes a number or words, and lists several matches instead of guessing', async () => {
  const h = await home()
  for (const f of ['Uses zsh', 'Uses vim', 'Lives in Vancouver']) await addFact(h, f)
  assert.deepEqual(await forgetFact(h, 'uses'), { matches: ['Uses zsh', 'Uses vim'] })
  assert.deepEqual(await forgetFact(h, 'nothing like it'), { matches: [] })
  assert.deepEqual(await forgetFact(h, '9'), { matches: [] })
  assert.deepEqual(await forgetFact(h, 'vancouver'), { removed: 'Lives in Vancouver' })
  assert.deepEqual(await forgetFact(h, '1'), { removed: 'Uses zsh' })
  assert.deepEqual(await readMemory(h), ['Uses vim'])
})

// MEM-6, MEM-7: a fact that could only fail does not ask; one declined is not written.
test('the remember tool asks only for facts it could keep, and writes only on yes', async () => {
  const h = await home()
  const asked: string[] = []
  let yes = false
  const tools = makeTools({ approve: async () => false, remember: async (f) => (asked.push(f), yes) }, { cwd: h, memory: h }) as any
  const run = (fact: string) => tools.remember.execute({ fact }, { toolCallId: 'x', messages: [] })
  assert.match(await run('one\ntwo'), /one line.*Nothing was remembered/)
  assert.match(await run('Uses zsh'), /declined/)
  yes = true
  assert.equal(await run('Uses zsh'), 'remembered: Uses zsh')
  assert.match(await run('uses zsh'), /already/)
  assert.deepEqual(asked, ['Uses zsh', 'Uses zsh'])
  assert.deepEqual(await readMemory(h), ['Uses zsh'])
  // MEM-4: no memory home, no tool.
  assert.equal((makeTools({ approve: async () => false }, { cwd: h }) as any).remember, undefined)
})

// MEM-14: the repository around a directory, the directory outside one, nothing at home.
test("a project is the repository around the directory, and its facts live in the user's home", async () => {
  const h = await home()
  const repo = join(h, 'code', 'app')
  await mkdir(join(repo, '.git'), { recursive: true })
  await mkdir(join(repo, 'src', 'deep'), { recursive: true })
  assert.equal(await projectRoot(join(repo, 'src', 'deep'), h), repo)
  assert.equal(await projectRoot(repo, h), repo)
  assert.equal(await projectRoot(join(h, 'code'), h), join(h, 'code'))
  assert.equal(await projectRoot(h, h), undefined)
  // A .git at home is not a project.
  await mkdir(join(h, '.git'))
  assert.equal(await projectRoot(join(h, 'notes'), h), join(h, 'notes'))
  assert.equal(await addFact(h, 'Tests run with npm test', repo), undefined)
  assert.equal(await addFact(h, 'tests run with  NPM test', repo), 'That is already remembered.')
  // Kept apart from the user's, in home, never in the repository.
  assert.deepEqual(await readMemory(h), [])
  assert.deepEqual(await readMemory(h, repo), ['Tests run with npm test'])
  assert.ok(memoryFile(h, repo).startsWith(join(h, '.neoai', 'memory') + '/'))
  assert.notEqual(memoryFile(h, repo), memoryFile(h, join(h, 'code')))
  assert.equal((await stat(memoryFile(h, repo))).mode & 0o777, 0o600)
  assert.deepEqual(await forgetFact(h, 'npm', repo), { removed: 'Tests run with npm test' })
})

// MEM-15
test("the project's facts follow the user's, under a heading naming it, each cut on its own", () => {
  const both = memorySection(['Uses zsh'], { root: '/code/app', facts: ['Tests run with npm test'] })
  assert.match(both, /about the user[^\n]*\n- Uses zsh\n\nWhat you remember about the project at \/code\/app[^\n]*\n- Tests run with npm test$/)
  assert.match(memorySection([], { root: '/code/app', facts: ['x'] }), /^\nWhat you remember about the project at \/code\/app/)
  assert.equal(memorySection(['Uses zsh'], { root: '/code/app', facts: [] }), memorySection(['Uses zsh']))
  const long = memorySection(['Uses zsh'], { root: '/a', facts: Array.from({ length: 30 }, () => 'z'.repeat(200)) })
  assert.ok(long.endsWith('…[memory truncated]'))
})

// MEM-16
test('the remember tool keeps a project fact for the project, asked as such, and only where there is one', async () => {
  const h = await home()
  const repo = join(h, 'app')
  const asked: [string, string | undefined][] = []
  const tools = makeTools({ approve: async () => false, remember: async (f, _s, _id, p) => (asked.push([f, p]), true) }, { cwd: repo, memory: h, project: repo }) as any
  const run = (input: object, t = tools) => t.remember.execute(input, { toolCallId: 'x', messages: [] })
  assert.match(tools.remember.description, /project to true/)
  assert.equal(await run({ fact: 'Uses tabs', project: true }), 'remembered for this project: Uses tabs')
  assert.equal(await run({ fact: 'Uses zsh' }), 'remembered: Uses zsh')
  assert.match(await run({ fact: 'uses TABS', project: true }), /already/)
  assert.deepEqual(asked, [['Uses tabs', repo], ['Uses zsh', undefined]])
  assert.deepEqual(await readMemory(h, repo), ['Uses tabs'])
  assert.deepEqual(await readMemory(h), ['Uses zsh'])
  const nowhere = makeTools({ approve: async () => false, remember: async () => assert.fail('asked') }, { cwd: h, memory: h }) as any
  assert.doesNotMatch(nowhere.remember.description, /project/)
  assert.match(await run({ fact: 'Uses tabs', project: true }, nowhere), /no project here/)
})
