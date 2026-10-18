/**
 * Reasoning models (Qwen, DeepSeek, …) inline their thinking as <think>…</think>,
 * often without the opening tag because the chat template already wrote it.
 * Hosted models keep reasoning on (MOD-11), so this still matters with navi's
 * think: false.
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

export function toMarkdown(text: string, streaming: boolean, showReasoning: boolean): string {
  const { reasoning, answer } = splitThinking(text)
  const parts: string[] = []
  if (reasoning && showReasoning) parts.push(reasoning.replace(/^/gm, '> '))
  if (answer) parts.push(answer)
  else if (reasoning && streaming) parts.push('_Thinking…_')
  return parts.join('\n\n') || '…'
}
