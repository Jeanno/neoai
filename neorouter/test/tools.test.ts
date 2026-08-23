import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toMessages, toolsPayload, fromChoice } from '../src/provider.ts'

test('serializes tools into the OpenAI function shape', () => {
  const tools = toolsPayload([
    {
      type: 'function',
      name: 'list_dir',
      description: 'List entries in a directory',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    },
  ])

  assert.deepEqual(tools, [
    {
      type: 'function',
      function: {
        name: 'list_dir',
        description: 'List entries in a directory',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      },
    },
  ])
})

test('sends a tool result back as a tool message keyed by call id', () => {
  const { messages } = toMessages([
    { role: 'user', content: [{ type: 'text', text: 'list /tmp' }] },
    {
      role: 'assistant',
      content: [
        { type: 'tool-call', toolCallId: 'call_1', toolName: 'list_dir', input: { path: '/tmp' } },
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call_1',
          toolName: 'list_dir',
          output: { type: 'text', value: 'a.txt\nb.txt' },
        },
      ],
    },
  ] as any)

  assert.deepEqual(messages[2], {
    role: 'tool',
    tool_call_id: 'call_1',
    content: 'a.txt\nb.txt',
  })
})

test('keeps the assistant tool call in history so the model sees its own turn', () => {
  const { messages } = toMessages([
    {
      role: 'assistant',
      content: [
        { type: 'tool-call', toolCallId: 'call_1', toolName: 'list_dir', input: { path: '/tmp' } },
      ],
    },
  ] as any)

  assert.deepEqual(messages[0], {
    role: 'assistant',
    content: '',
    tool_calls: [
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'list_dir', arguments: '{"path":"/tmp"}' },
      },
    ],
  })
})

test('reads a tool call out of an ollama response as a tool-call content part', () => {
  // Captured verbatim from ollama 0.32.15 / qwen3.5:2b-q4_K_M.
  const choice = {
    finish_reason: 'tool_calls',
    message: {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call_fu2at20l',
          index: 0,
          type: 'function',
          function: { name: 'list_dir', arguments: '{"path":"/tmp"}' },
        },
      ],
    },
  }

  // input stays the raw JSON string: LanguageModelV2ToolCall types it as
  // `input: string` and the SDK parses it against the tool's schema itself.
  assert.deepEqual(fromChoice(choice), [
    {
      type: 'tool-call',
      toolCallId: 'call_fu2at20l',
      toolName: 'list_dir',
      input: '{"path":"/tmp"}',
    },
  ])
})

test('still returns plain text when no tool was called', () => {
  const choice = { finish_reason: 'stop', message: { role: 'assistant', content: 'hello' } }

  assert.deepEqual(fromChoice(choice), [{ type: 'text', text: 'hello' }])
})
