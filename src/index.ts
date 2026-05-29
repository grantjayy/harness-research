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
  `Run a complete deep research workflow and return the finished report artifact paths.

This is not a generic search tool. Use it only when the user wants deep research: a multi-source investigation, source evaluation, cross-verification, synthesis, and report output.

Internal workflow:
1. Generate a research plan from the topic.
2. Search enabled source classes internally: web, academic, Reddit, YouTube/transcripts, X/Twitter, direct URLs, and finance when relevant.
3. Deduplicate and evaluate sources with CRAAP-style scoring.
4. Cross-verify findings.
5. Write a full report and render artifacts.

This call waits for the research run to finish. Configure the MCP client timeout high enough for deep research runs, usually 1200 seconds.`,
  {
    topic: z.string().describe("Deep research topic, e.g. 'Current best practices for AI agent memory systems'"),
    output_dir: z.string().optional().describe("Output directory for report artifacts. Defaults to current working directory."),
    formats: z.array(z.enum(["html", "docx", "pdf", "markdown"])).optional()
      .describe("Requested output formats. Markdown is always generated as a fallback; default report formats are html and docx."),
    sources: z.array(z.enum(["tavily", "brave", "arxiv", "pubmed", "tushare", "reddit", "youtube", "x", "web_extract"])).optional()
      .describe("Internal source classes to include. Default: all available/source-relevant source classes."),
    web_queries: z.array(z.string()).optional().describe("Optional explicit internal web search queries. Defaults to generated plan web keywords."),
    reddit_queries: z.array(z.string()).optional().describe("Optional explicit internal Reddit research queries."),
    youtube_queries: z.array(z.string()).optional().describe("Optional explicit internal YouTube research queries."),
    x_queries: z.array(z.string()).optional().describe("Optional explicit internal X/Twitter research briefs or queries."),
    urls: z.array(z.string()).optional().describe("Optional URLs to extract internally as report sources."),
    reddit_subreddit: z.string().optional().describe("Optional subreddit restriction for internal Reddit research, without r/."),
    reddit_sort: z.enum(["relevance", "hot", "top", "new", "comments"]).optional().describe("Internal Reddit sort. Default: relevance."),
    reddit_time_filter: z.enum(["hour", "day", "week", "month", "year", "all"]).optional().describe("Internal Reddit time filter. Default: year."),
    include_youtube_transcripts: z.boolean().optional().describe("Fetch available YouTube captions/transcripts and include them as internal source text."),
  },
  async (args) => {
    if (!isSetupComplete() && !hasMinimalKeys()) {
      return {
        content: [{
          type: "text" as const,
          text: "Deep Research MCP is not configured yet. Run the local setup and add at least one search key plus one LLM key in ~/.harness-research/.env.",
        }],
      }
    }

    if (!hasMinimalKeys()) {
      return {
        content: [{
          type: "text" as const,
          text: "Missing required API key. Need OPENROUTER_API_KEY for Kimi through OpenRouter in ~/.harness-research/.env or ~/.hermes/.env.",
        }],
      }
    }

    const result = await runResearch(args.topic, {
      outputDir: args.output_dir,
      formats: args.formats,
      sources: args.sources,
      web_queries: args.web_queries,
      reddit_queries: args.reddit_queries,
      youtube_queries: args.youtube_queries,
      x_queries: args.x_queries,
      urls: args.urls,
      reddit_subreddit: args.reddit_subreddit,
      reddit_sort: args.reddit_sort,
      reddit_time_filter: args.reddit_time_filter,
      include_youtube_transcripts: args.include_youtube_transcripts,
    })

    const outputs = Object.entries(result.outputs)
      .filter(([, filePath]) => Boolean(filePath))
      .map(([format, filePath]) => `  ${format.toUpperCase()}: ${filePath}`)
      .join("\n")

    const sourceStats = Object.entries(result.stats)
      .filter(([, value]) => typeof value === "object" && value && "results" in value)
      .map(([source, value]) => {
        const v = value as { queries: number; results: number }
        return `${source}: ${v.results} results / ${v.queries} queries`
      })
      .join("; ")

    return {
      content: [{
        type: "text" as const,
        text: `Deep research completed.\n\nTopic: ${args.topic}\n\nOutputs:\n${outputs || "  No output files generated."}\n\nSources: ${sourceStats}\n\nSummary:\n${result.summary}`,
      }],
    }
  },
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(console.error)
