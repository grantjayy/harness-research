// Harness Research MCP Server — Main Entry Point
// Exposes one top-level deep_research tool. Source search/read helpers stay internal.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { loadEnv, isSetupComplete, hasMinimalKeys } from "./utils/config.js"
import { runResearch } from "./core/pipeline.js"

// Load environment
loadEnv()

const server = new McpServer({
  name: "deep-research",
  version: "2.1.0",
})

server.tool(
  "deep_research",
  `Run a complete deep research workflow and return the finished Markdown report inline.

This is not a generic search tool. Use it only when the user wants deep research: a multi-source investigation, source evaluation, cross-verification, synthesis, and a Markdown report.

The only user/model-provided input is the research topic. Sources, transcripts, extraction, model selection, and output format are fixed internally.

Internal workflow:
1. Generate a research plan from the topic.
2. Search the standard internal source set: web search, academic sources, Reddit, YouTube with transcripts, X/Twitter, direct extraction from discovered web results, and finance when relevant.
3. Deduplicate and evaluate sources with CRAAP-style scoring.
4. Cross-verify findings.
5. Write and return a full Markdown report.

This call waits for the research run to finish. Configure the MCP client timeout high enough for deep research runs, usually 1200 seconds.`,
  {
    topic: z.string().describe("Deep research topic, e.g. 'Current best practices for AI agent memory systems'"),
  },
  async (args) => {
    if (!isSetupComplete() && !hasMinimalKeys()) {
      return {
        content: [{
          type: "text" as const,
          text: "Deep Research MCP is not configured yet. Add Alloy Runtime credentials in ~/.harness-research/.env, ~/.hermes/.env, or ~/.hermes/hermes.env.",
        }],
      }
    }

    if (!hasMinimalKeys()) {
      return {
        content: [{
          type: "text" as const,
          text: "Missing required Alloy Runtime credentials. Need ALLOY_RUNTIME_API_URL and ALLOY_RUNTIME_API_KEY in ~/.harness-research/.env, ~/.hermes/.env, or ~/.hermes/hermes.env.",
        }],
      }
    }

    const result = await runResearch(args.topic)

    return {
      content: [{
        type: "text" as const,
        text: result.markdown,
      }],
    }
  },
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(console.error)
