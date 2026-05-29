import assert from "node:assert/strict"
import test from "node:test"

import { createLLMConfig, RESEARCH_MODEL } from "../src/core/llm.js"

test("deep research uses Kimi K2.6 through Alloy Runtime / Fireworks as the fixed internal research model", () => {
  const previousUrl = process.env.ALLOY_RUNTIME_API_URL
  const previousKey = process.env.ALLOY_RUNTIME_API_KEY
  process.env.ALLOY_RUNTIME_API_URL = "https://api.alloyruntime.test"
  process.env.ALLOY_RUNTIME_API_KEY = "test-alloy-key"

  try {
    const config = createLLMConfig()
    assert.equal(config.provider, "alloy-runtime")
    assert.equal(config.model, RESEARCH_MODEL)
    assert.equal(config.model, "fireworks-ai/accounts/fireworks/models/kimi-k2p6")
    assert.equal(config.baseUrl, "https://api.alloyruntime.test")
    assert.equal(config.apiKey, "test-alloy-key")
  } finally {
    if (previousUrl === undefined) delete process.env.ALLOY_RUNTIME_API_URL
    else process.env.ALLOY_RUNTIME_API_URL = previousUrl

    if (previousKey === undefined) delete process.env.ALLOY_RUNTIME_API_KEY
    else process.env.ALLOY_RUNTIME_API_KEY = previousKey
  }
})
