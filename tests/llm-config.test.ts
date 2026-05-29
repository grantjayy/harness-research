import assert from "node:assert/strict"
import test from "node:test"

import { createLLMConfig, RESEARCH_MODEL } from "../src/core/llm.js"

test("deep research uses Kimi through OpenRouter as the fixed internal research model", () => {
  const previousOpenRouterKey = process.env.OPENROUTER_API_KEY
  process.env.OPENROUTER_API_KEY = "test-openrouter-key"

  try {
    const config = createLLMConfig()
    assert.equal(config.provider, "openrouter")
    assert.equal(config.model, RESEARCH_MODEL)
    assert.equal(config.model, "moonshotai/kimi-k2.5")
    assert.equal(config.baseUrl, "https://openrouter.ai/api/v1")
    assert.equal(config.apiKey, "test-openrouter-key")
  } finally {
    if (previousOpenRouterKey === undefined) {
      delete process.env.OPENROUTER_API_KEY
    } else {
      process.env.OPENROUTER_API_KEY = previousOpenRouterKey
    }
  }
})
