/**
 * Hosted providers, each through its OpenAI-compatible API. Adding one is one
 * entry here (navi MOD-14).
 *
 * `recommended` are hand-picked chat models in the provider's own id format.
 * They are shown only when the provider's live model list has them, so a stale
 * id costs a row, not an error.
 */
export interface Provider {
  id: string
  name: string
  baseURL: string
  /** The variable people already export for it; wins over a saved key. */
  env: string
  /** Where to create a key. */
  keyPage: string
  recommended: string[]
  /**
   * A GET under baseURL that needs the key: 401/403 (or 400, which Gemini and
   * xAI send) for a bad one. OpenRouter's /models is public, so it uses /key.
   */
  check?: string
  /** Path of the model list, when /models needs a query to list everything. */
  models?: string
  /** Headers for check and model list calls, when Bearer is not what they take. */
  listHeaders?: (key: string) => Record<string, string>
}

export const PROVIDERS: Provider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    env: 'OPENAI_API_KEY',
    keyPage: 'https://platform.openai.com/api-keys',
    recommended: ['gpt-6.1-sol', 'gpt-6-luna', 'gpt-5.6-terra'],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseURL: 'https://api.anthropic.com/v1',
    env: 'ANTHROPIC_API_KEY',
    keyPage: 'https://platform.claude.com/settings/keys',
    recommended: ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'],
    // Chat through the compat layer takes Bearer; the model list is the native
    // API, which wants x-api-key and pages at 20 by default.
    models: '/models?limit=1000',
    listHeaders: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
  },
  {
    id: 'google',
    name: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    env: 'GEMINI_API_KEY',
    keyPage: 'https://aistudio.google.com/apikey',
    recommended: ['gemini-3.8-flash', 'gemini-4-argon', 'gemini-3.5-flash-lite'],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    env: 'OPENROUTER_API_KEY',
    keyPage: 'https://openrouter.ai/keys',
    recommended: [
      'deepseek/deepseek-v4.1-flash',
      'anthropic/claude-haiku-5.5',
      'z-ai/glm-5.3',
      'google/gemini-4-argon',
      'anthropic/claude-sonnet-5.5',
    ],
    check: '/key',
  },
  {
    id: 'groq',
    name: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    env: 'GROQ_API_KEY',
    keyPage: 'https://console.groq.com/keys',
    recommended: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b'],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    env: 'DEEPSEEK_API_KEY',
    keyPage: 'https://platform.deepseek.com/api_keys',
    recommended: ['deepseek-chat', 'deepseek-v4.1-flash', 'deepseek-v4-pro', 'deepseek-reasoner'],
  },
  {
    id: 'mistral',
    name: 'Mistral',
    baseURL: 'https://api.mistral.ai/v1',
    env: 'MISTRAL_API_KEY',
    keyPage: 'https://console.mistral.ai/api-keys',
    recommended: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest'],
  },
  {
    id: 'xai',
    name: 'xAI',
    baseURL: 'https://api.x.ai/v1',
    env: 'XAI_API_KEY',
    keyPage: 'https://console.x.ai',
    recommended: ['grok-4.7', 'grok-4.3'],
  },
]

export function providerById(id: string): Provider | undefined {
  return PROVIDERS.find((p) => p.id === id)
}
