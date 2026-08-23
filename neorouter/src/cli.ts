import { inspect } from './helpers.ts'

const r = await inspect()
const gib = (n: number | null) => (n == null ? '—' : `${n.toFixed(1)} GiB`)

console.log(`${r.hardware.gpu ?? 'CPU only'}  ${r.hardware.cores} cores`)
console.log(`memory   capacity ${gib(r.hardware.vramTotalGiB)}  free ${gib(r.hardware.vramFreeGiB)}`)
for (const s of r.reachable) console.log(`listening ${s.backend.padEnd(10)} ${s.models} models  ${s.at}`)
for (const l of r.launchable) console.log(`idle      ${l.backend.padEnd(10)} ${l.models} models  ${l.bin}`)
for (const h of r.hosted) console.log(`hosted    ${h.backend.padEnd(10)} ${h.at}`)
console.log(`\nchose ${r.chose}`)
