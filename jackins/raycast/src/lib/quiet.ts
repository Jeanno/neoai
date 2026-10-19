/**
 * Raycast has no terminal: neorouter's backend line and the AI SDK's warnings
 * would only land in its log (HAR-5). Imported before anything that uses
 * either, so both are off by the time a model is resolved or called.
 */
process.env.NEOROUTER_QUIET = '1'
;(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false

export {}
