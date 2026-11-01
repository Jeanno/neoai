import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fromWall, parseFooter, parseTzif, wall, type Offset } from '../src/clock.ts'

const ZONEINFO = ['/usr/share/zoneinfo', '/var/db/timezone/zoneinfo'].find((d) => existsSync(`${d}/America/New_York`))

test('SCH-14: TZ rule strings, fixed and with daylight time', () => {
  assert.deepEqual(parseFooter('MST7'), { std: -7 * 3600 })
  assert.deepEqual(parseFooter('<+0530>-5:30'), { std: 5.5 * 3600 })
  const ny = parseFooter('EST5EDT,M3.2.0,M11.1.0')!
  assert.equal(ny.std, -5 * 3600)
  assert.equal(ny.dst?.offset, -4 * 3600)
  assert.deepEqual(ny.dst?.start, { month: 3, week: 2, day: 0, at: 7200 })
  assert.equal(parseFooter('nonsense'), undefined)
})

test('SCH-14: a zone file gives the offset at any instant, past its last transition too', { skip: !ZONEINFO && 'no zoneinfo here' }, () => {
  const ny = parseTzif(readFileSync(`${ZONEINFO}/America/New_York`))!
  assert.equal(ny(new Date('2030-01-15T12:00:00Z')), -300)
  assert.equal(ny(new Date('2030-07-15T12:00:00Z')), -240)
  // The changes themselves: 2030-03-10 07:00Z and 2030-11-03 06:00Z.
  assert.equal(ny(new Date('2030-03-10T06:59:59Z')), -300)
  assert.equal(ny(new Date('2030-03-10T07:00:00Z')), -240)
  assert.equal(ny(new Date('2030-11-03T05:59:59Z')), -240)
  assert.equal(ny(new Date('2030-11-03T06:00:00Z')), -300)
  assert.equal(ny(new Date('1990-07-01T12:00:00Z')), -240)
  assert.equal(parseTzif(Buffer.from('not a zone file at all, not at all, no')), undefined)
})

test('SCH-14: wall time and back, across a change', () => {
  const eastern: Offset = (t) => (t >= new Date('2030-03-10T07:00:00Z') ? -240 : -300)
  const t = fromWall(2030, 2, 10, 8, 0, eastern)
  assert.equal(t.toISOString(), '2030-03-10T12:00:00.000Z')
  assert.equal(wall(t, eastern).getUTCHours(), 8)
  assert.equal(fromWall(2030, 2, 9, 8, 0, eastern).toISOString(), '2030-03-09T13:00:00.000Z')
})
