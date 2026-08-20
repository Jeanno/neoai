import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Hardware } from './types.ts'

const run = promisify(execFile)
const GiB = 1024 ** 3

async function nvidia(): Promise<{ gpu: string; vramFreeGiB: number; vramTotalGiB: number } | null> {
  try {
    const { stdout } = await run('nvidia-smi', [
      '--query-gpu=name,memory.free,memory.total',
      '--format=csv,noheader,nounits',
    ])
    const [name, freeMiB, totalMiB] = stdout.trim().split('\n')[0].split(',')
    return {
      gpu: name.trim(),
      vramFreeGiB: Number(freeMiB) / 1024,
      vramTotalGiB: Number(totalMiB) / 1024,
    }
  } catch {
    return null
  }
}

/** macOS keeps most RAM in reclaimable caches, so os.freemem() reads near zero. */
async function darwinAvailableBytes(): Promise<number> {
  const { stdout } = await run('vm_stat')
  const pageSize = Number(/page size of (\d+)/.exec(stdout)?.[1] ?? 16384)
  const pages = (label: string) =>
    Number(new RegExp(`${label}:\\s+(\\d+)`).exec(stdout)?.[1] ?? 0)
  const reclaimable =
    pages('Pages free') + pages('Pages inactive') + pages('Pages speculative') +
    pages('Pages purgeable')
  return reclaimable * pageSize
}

async function availableBytes(): Promise<number> {
  if (process.platform === 'darwin') return darwinAvailableBytes().catch(() => os.freemem())
  return os.freemem()
}

async function appleSilicon(
  free: number,
): Promise<{ gpu: string; vramFreeGiB: number; vramTotalGiB: number } | null> {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') return null
  const { stdout } = await run('sysctl', ['-n', 'machdep.cpu.brand_string']).catch(() => ({
    stdout: 'Apple Silicon',
  }))
  // Metal caps a process at ~75% of unified memory; the rest is the OS's.
  const budget = Math.min(os.totalmem() * 0.75, free) / GiB
  return {
    gpu: stdout.trim(),
    vramFreeGiB: Math.max(0, budget),
    vramTotalGiB: (os.totalmem() * 0.75) / GiB,
  }
}

let cached: Promise<Hardware> | null = null

export function detectHardware(): Promise<Hardware> {
  cached ??= (async () => {
    const free = await availableBytes()
    const accel = (await nvidia()) ?? (await appleSilicon(free))
    return {
      platform: process.platform,
      arch: process.arch,
      cores: os.cpus().length,
      ramTotalGiB: os.totalmem() / GiB,
      ramFreeGiB: free / GiB,
      gpu: accel?.gpu ?? null,
      vramFreeGiB: accel?.vramFreeGiB ?? null,
      vramTotalGiB: accel?.vramTotalGiB ?? null,
    }
  })()
  return cached
}

/**
 * Two different questions. `free` is what we can allocate right now, and is the
 * honest budget when WE are about to load the weights. `capacity` is what the
 * machine can hold at all — the right budget when an existing server manages
 * residency itself, because measuring free memory there makes the answer flap:
 * a server that has just loaded a 6 GiB model reports too little free memory to
 * "fit" the model it is already running.
 */
export function memoryBudgetGiB(hw: Hardware, mode: 'free' | 'capacity' = 'capacity'): number {
  if (mode === 'capacity') return hw.vramTotalGiB ?? Math.max(0, hw.ramTotalGiB * 0.75)
  return hw.vramFreeGiB ?? Math.max(0, hw.ramFreeGiB - 2)
}
