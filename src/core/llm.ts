// Harness Research MCP Server — LLM Abstraction Layer

import type { LLMConfig } from "../utils/types.js"
import { sleep } from "../utils/json.js"
import { LLM_TIMEOUT } from "../utils/config.js"

export const RESEARCH_MODEL = "moonshotai/kimi-k2.6"

/** Create the fixed research-model config. */
export function createLLMConfig(): LLMConfig {
  return {
    provider: "openrouter",
    model: RESEARCH_MODEL,
    apiKey: process.env.OPENROUTER_API_KEY || "",
    baseUrl: "https://openrouter.ai/api/v1",
  }
}

/** Call LLM with retry logic */
export async function callLLM(
  config: LLMConfig,
  prompt: string,
  temperature: number = 0.3,
  maxTokens: number = 4096,
): Promise<string> {
  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.apiKey}`,
          ...(config.provider === "openrouter" ? {
            "HTTP-Referer": "https://github.com/Nimo1987/harness-research",
            "X-Title": "Harness Research",
          } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: prompt }],
          temperature,
          max_tokens: maxTokens,
          reasoning: { effort: "minimal", exclude: true },
        }),
        signal: AbortSignal.timeout(LLM_TIMEOUT),
      })

      if (resp.status === 429) {
        const waitSec = attempt * 30
        await sleep(waitSec * 1000)
        continue
      }

      if (!resp.ok) {
        const text = await resp.text()
        throw new Error(`LLM API ${resp.status}: ${text.slice(0, 200)}`)
      }

      const data = (await resp.json()) as any
      return data.choices?.[0]?.message?.content || ""
    } catch (e: any) {
      const message = String(e?.message || e || "")
      const transient =
        e?.name === "TimeoutError" ||
        e?.name === "AbortError" ||
        /terminated|fetch failed|ECONNRESET|ETIMEDOUT|UND_ERR|socket|network/i.test(message)

      if (attempt === 3 || !transient) throw e

      await sleep(attempt * 5000)
      continue
    }
  }
  throw new Error("LLM call failed after 3 retries")
}
