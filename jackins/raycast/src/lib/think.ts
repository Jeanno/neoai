/**
 * Reasoning models (Qwen, DeepSeek, …) inline their thinking as <think>…</think>,
 * often without the opening tag because the chat template already wrote it.
 * Models think by default (MOD-50), so this matters whenever a server writes
 * its thinking into the text.
 */
export function splitThinking(text: string): { reasoning: string; answer: string } {
  const end = text.indexOf('</think>')
  if (end >= 0) {
    return {
      reasoning: text
        .slice(0, end)
        .replace(/^\s*<think>/, '')
        .trim(),
      answer: text.slice(end + '</think>'.length).trim(),
    }
  }
  if (/^\s*<think>/.test(text)) return { reasoning: text.replace(/^\s*<think>/, '').trim(), answer: '' }
  return { reasoning: '', answer: text }
}
