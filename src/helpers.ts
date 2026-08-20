import { generateText, streamText } from 'ai'
import { auto } from './provider.ts'
import { detectHardware } from './hardware.ts'
import { reachableServers, listModels } from './discover.ts'
import { launchable } from './launch.ts'
import { hostedServers, hostedModels } from './hosted.ts'
import { resolveBackend } from './resolve.ts'

export async function generate(prompt: string): Promise<string> {
  const { text } = await generateText({ model: auto(), prompt })
  return text
}

export function stream(prompt: string): AsyncIterable<string> {
  return streamText({ model: auto(), prompt }).textStream
}

/** Diagnostics. Never required to make a call — this answers "why this model?". */
export async function inspect() {
  const [hardware, reachable, hosted] = await Promise.all([
    detectHardware(),
    reachableServers(),
    hostedServers(),
  ])
  return {
    hardware,
    reachable: await Promise.all(
      reachable.map(async (s) => ({
        backend: s.backend,
        at: s.baseURL,
        models: (await listModels(s).catch(() => [])).length,
      })),
    ),
    launchable: (await launchable(reachable)).map((l) => ({
      backend: l.backend,
      bin: l.bin,
      models: l.files.length,
    })),
    hosted: hosted.map((h) => ({ backend: h.backend, at: h.baseURL, local: false })),
    chose: await resolveBackend().then((r) => `${r.backend}:${r.modelId}`),
  }
}
