// Harness Research MCP Server — LLM Abstraction Layer

import type { LLMConfig } from "../utils/types.js"
import { sleep } from "../utils/json.js"
import { LLM_TIMEOUT } from "../utils/config.js"

export const RESEARCH_MODEL = "fireworks-ai/accounts/fireworks/models/kimi-k2p6"

/** Create the fixed research-model config. */
export function createLLMConfig(): LLMConfig {
  return {
    provider: "alloy-runtime",
    model: RESEARCH_MODEL,
    apiKey: process.env.ALLOY_RUNTIME_API_KEY || "",
    baseUrl: process.env.ALLOY_RUNTIME_API_URL || "",
  }
}

function alloyGenerateUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "")
  if (trimmed.endsWith("/api/v1/generate/text")) return trimmed
  return `${trimmed}/api/v1/generate/text`
}

function extractAlloyText(data: any): string {
  if (typeof data?.output_text === "string") return data.output_text
  if (typeof data?.text === "string") return data.text
  if (typeof data?.output === "string") return data.output
  if (typeof data?.result?.output_text === "string") return data.result.output_text
  if (typeof data?.result?.text === "string") return data.result.text
  if (typeof data?.structured_output === "string") return data.structured_output
  return ""
}

/** Call fixed Kimi K2.6 through Alloy Runtime / Fireworks with retry logic. */
export async function callLLM(
  config: LLMConfig,
  prompt: string,
): Promise<string> {
  if (!config.baseUrl) throw new Error("Missing ALLOY_RUNTIME_API_URL")
  const url = alloyGenerateUrl(config.baseUrl)

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          prompt,
          mode: "sync",
          tags: ["deep_research_mcp"],
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
        throw new Error(`Alloy Runtime API ${resp.status}: ${text.slice(0, 300)}`)
      }

      const data = (await resp.json()) as any
      return extractAlloyText(data)
    } catch (e: any) {
      const message = String(e?.message || e || "")
      const transient =
        e?.name === "TimeoutError" ||
        e?.name === "AbortError" ||
        /terminated|fetch failed|ECONNRESET|ETIMEDOUT|UND_ERR|socket|network|timeout/i.test(message)

      if (attempt === 3 || !transient) throw e

      await sleep(attempt * 5000)
      continue
    }
  }
  throw new Error("LLM call failed after 3 retries")
}
