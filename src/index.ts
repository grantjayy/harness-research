// Harness Research MCP Server — Main Entry Point
// Registers tools and starts stdio transport

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { loadEnv, isSetupComplete, hasMinimalKeys, getPlatformCapabilities } from "./utils/config.js"
import { runResearch, startResearchBackground, getTask, getAllTasks } from "./core/pipeline.js"
import { searchTavily, searchBrave, searchArxiv, searchPubmed, searchReddit, searchYoutube, searchX, extractWebPages, readRedditPost, fetchYoutubeTranscript } from "./core/search.js"
import { buildSourceQueries } from "./core/source-params.js"
import { dedup } from "./core/dedup.js"

// Load environment
loadEnv()

const server = new McpServer({
  name: "harness-research",
  version: "2.0.0",
})

// ── Tool 1: harness_research (full deep research) ──

server.tool(
  "harness_research",
  `Start a deep research session: multi-source search (Tavily/Brave/arXiv/PubMed/Tushare) + CRAAP source evaluation + cross-verification → professional HTML/DOCX/PDF report.

IMPORTANT: This tool returns IMMEDIATELY with a task_id. The research runs in the background and takes ~8-12 minutes. After calling this tool, you MUST poll harness_status with the returned task_id every 30-60 seconds until status is "completed" or "failed". Do NOT wait idle — poll actively.

Workflow:
1. Call harness_research → get task_id (returns in <1 second)
2. Call harness_status with task_id every 30-60s to check progress
3. When status is "completed", harness_status returns the output file paths

Driven by affordable models like Kimi K2.5 (~$0.01/run).`,
  {
    topic: z.string().describe("Research topic, e.g. 'Global AI chip market landscape 2025'"),
    provider: z.enum(["kimi", "openrouter"]).optional().describe("LLM provider: kimi (default, cheapest) or openrouter"),
    model: z.string().optional().describe("Model name. kimi default: kimi-k2.5, openrouter default: anthropic/claude-sonnet-4"),
    output_dir: z.string().optional().describe("Output directory for reports. Defaults to current working directory."),
    formats: z.array(z.enum(["html", "docx", "pdf"])).optional().describe("Output formats. Default: ['html', 'docx']. PDF only available on macOS."),
    sources: z.array(z.enum(["tavily", "brave", "arxiv", "pubmed", "tushare", "reddit", "youtube", "x", "web_extract"])).optional()
      .describe("Research sources to include. Default: all available/source-relevant sources."),
    web_queries: z.array(z.string()).optional().describe("Explicit web search queries. Defaults to the generated plan web keywords."),
    reddit_queries: z.array(z.string()).optional().describe("Explicit Reddit search queries."),
    youtube_queries: z.array(z.string()).optional().describe("Explicit YouTube search queries."),
    x_queries: z.array(z.string()).optional().describe("Explicit X/Twitter search briefs or queries."),
    urls: z.array(z.string()).optional().describe("URLs to extract directly via web_extract."),
    reddit_subreddit: z.string().optional().describe("Optional subreddit restriction for Reddit searches, without r/."),
    reddit_sort: z.enum(["relevance", "hot", "top", "new", "comments"]).optional().describe("Reddit sort. Default: relevance."),
    reddit_time_filter: z.enum(["hour", "day", "week", "month", "year", "all"]).optional().describe("Reddit time filter. Default: year."),
    include_youtube_transcripts: z.boolean().optional().describe("Fetch available YouTube captions/transcripts and include them as source text."),
  },
  async (args) => {
    // Pre-flight checks
    if (!isSetupComplete() && !hasMinimalKeys()) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Harness Research is not configured yet.\n\nPlease run:\n  npx harness-research-mcp setup\n\nThis will guide you through API key configuration.",
          },
        ],
      }
    }

    if (!hasMinimalKeys()) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Missing required API keys. You need at least:\n1. One search key (TAVILY_API_KEY or BRAVE_API_KEY)\n2. One LLM key (KIMI_API_KEY or OPENROUTER_API_KEY)\n\nRun: npx harness-research-mcp setup",
          },
        ],
      }
    }

    // Start research in background (fire-and-forget), return task_id immediately
    const taskId = startResearchBackground(args.topic, {
      provider: args.provider,
      model: args.model,
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

    return {
      content: [
        {
          type: "text" as const,
          text: `Research started!\n\nTask ID: ${taskId}\nTopic: ${args.topic}\n\nThe research is running in the background and will take ~8-12 minutes.\nPoll progress with: harness_status(task_id="${taskId}")\nPoll every 30-60 seconds until status is "completed".`,
        },
      ],
    }
  },
)

// ── Tool 2: harness_search (quick multi-source search) ──

server.tool(
  "harness_search",
  "Quick multi-source search without generating a full report. Returns structured results from web, academic, Reddit, YouTube, X, and direct URL extraction sources.",
  {
    query: z.string().describe("Fallback search query"),
    sources: z.array(z.enum(["tavily", "brave", "arxiv", "pubmed", "reddit", "youtube", "x", "web_extract"])).optional()
      .describe("Which sources to search. Default: all available sources with configured keys."),
    limit: z.number().optional().describe("Max results per source/query. Default: 5."),
    web_queries: z.array(z.string()).optional().describe("Explicit Tavily/Brave web queries."),
    reddit_queries: z.array(z.string()).optional().describe("Explicit Reddit queries."),
    youtube_queries: z.array(z.string()).optional().describe("Explicit YouTube queries."),
    x_queries: z.array(z.string()).optional().describe("Explicit X/Twitter search briefs or queries."),
    urls: z.array(z.string()).optional().describe("URLs to fetch and extract directly."),
    reddit_subreddit: z.string().optional().describe("Optional subreddit restriction for Reddit search."),
    reddit_sort: z.enum(["relevance", "hot", "top", "new", "comments"]).optional().describe("Reddit sort. Default: relevance."),
    reddit_time_filter: z.enum(["hour", "day", "week", "month", "year", "all"]).optional().describe("Reddit time filter. Default: year."),
    include_youtube_transcripts: z.boolean().optional().describe("Fetch available YouTube captions/transcripts."),
  },
  async (args) => {
    const sources = args.sources || ["tavily", "brave", "arxiv", "pubmed", "reddit", "youtube", "x", "web_extract"]
    const querySet = buildSourceQueries({
      query: args.query,
      web_queries: args.web_queries,
      reddit_queries: args.reddit_queries,
      youtube_queries: args.youtube_queries,
      x_queries: args.x_queries,
      urls: args.urls,
    })

    const promises: Promise<any[]>[] = []
    if (sources.includes("tavily")) promises.push(searchTavily(querySet.web))
    if (sources.includes("brave")) promises.push(searchBrave(querySet.web))
    if (sources.includes("arxiv")) promises.push(searchArxiv(querySet.web))
    if (sources.includes("pubmed")) promises.push(searchPubmed(querySet.web))
    if (sources.includes("reddit")) promises.push(searchReddit(querySet.reddit, {
      limit: args.limit,
      subreddit: args.reddit_subreddit,
      sort: args.reddit_sort,
      time_filter: args.reddit_time_filter,
    }))
    if (sources.includes("youtube")) promises.push(searchYoutube(querySet.youtube, {
      limit: args.limit,
      include_transcripts: args.include_youtube_transcripts,
    }))
    if (sources.includes("x")) promises.push(searchX(querySet.x, { limit: args.limit }))
    if (sources.includes("web_extract") && querySet.urls.length > 0) promises.push(extractWebPages(querySet.urls))

    const results = await Promise.allSettled(promises)
    let all: any[] = []
    for (const r of results) {
      if (r.status === "fulfilled") all = all.concat(r.value)
    }

    const dedupedResults = dedup(all).slice(0, args.limit || 20)

    const text = dedupedResults.length === 0
      ? "No results found. Check source API keys and/or try narrower source-specific queries."
      : dedupedResults
        .map(
          (r, i) =>
            `[${i + 1}] ${r.title}\n    ${r.url}\n    Source: ${r.source} | ${r.published_date || "N/A"}\n    ${r.snippet.slice(0, 500)}`,
        )
        .join("\n\n")

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${dedupedResults.length} results for "${args.query}":\n\n${text}`,
        },
      ],
    }
  },
)

// ── Tool 3: harness_status (check research task progress) ──

server.tool(
  "harness_status",
  `Check the progress of a research task started by harness_research.

After calling harness_research, you MUST poll this tool with the returned task_id every 30-60 seconds.
- status "running": research is in progress, keep polling
- status "completed": research is done, output file paths are included
- status "failed": an error occurred, error message is included

If no task_id is provided, lists all tasks.`,
  {
    task_id: z.string().optional().describe("Task ID to check. If omitted, lists all tasks."),
  },
  async (args) => {
    if (args.task_id) {
      const task = getTask(args.task_id)
      if (!task) {
        return {
          content: [{ type: "text" as const, text: `Task not found: ${args.task_id}` }],
        }
      }

      const duration = task.endTime
        ? `${Math.round((task.endTime - task.startTime) / 1000)}s`
        : `${Math.round((Date.now() - task.startTime) / 1000)}s (running)`

      let text = `Task: ${task.id}\nTopic: ${task.topic}\nStatus: ${task.status}\nStep: ${task.step}\nProgress: ${task.progress}%\nDuration: ${duration}`

      if (task.error) text += `\nError: ${task.error}`
      if (task.outputs) {
        text += "\nOutputs:"
        for (const [fmt, filePath] of Object.entries(task.outputs)) {
          if (filePath) text += `\n  ${fmt.toUpperCase()}: ${filePath}`
        }
      }

      return { content: [{ type: "text" as const, text }] }
    }

    // List all tasks
    const allTasks = getAllTasks()
    if (allTasks.length === 0) {
      return { content: [{ type: "text" as const, text: "No research tasks found." }] }
    }

    const text = allTasks
      .map(t => `[${t.status}] ${t.id} — "${t.topic}" (${t.progress}%)`)
      .join("\n")

    return { content: [{ type: "text" as const, text: `Research tasks:\n${text}` }] }
  },
)

server.tool(
  "harness_read_reddit",
  "Read a Reddit post and top comments as a research source.",
  {
    url_or_id: z.string().describe("Reddit post URL or comments ID."),
  },
  async (args) => {
    const results = await readRedditPost(args.url_or_id)
    const text = results.length
      ? results.map(r => `${r.title}\n${r.url}\nSource: ${r.source} | ${r.published_date || "N/A"}\n${r.snippet}`).join("\n\n")
      : "No Reddit post content found."
    return { content: [{ type: "text" as const, text }] }
  },
)

server.tool(
  "harness_youtube_transcript",
  "Fetch available captions/transcript text for a YouTube video URL or ID.",
  {
    url_or_id: z.string().describe("YouTube URL or 11-character video ID."),
  },
  async (args) => {
    const transcript = await fetchYoutubeTranscript(args.url_or_id)
    return {
      content: [{
        type: "text" as const,
        text: transcript || "No transcript/captions found for this YouTube video.",
      }],
    }
  },
)

server.tool(
  "harness_extract_web",
  "Fetch and extract readable text from one or more URLs as research sources.",
  {
    urls: z.array(z.string()).describe("URLs to fetch and extract."),
  },
  async (args) => {
    const results = await extractWebPages(args.urls)
    const text = results.length
      ? results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\nSource: ${r.source}\n${r.snippet}`).join("\n\n")
      : "No extractable web content found."
    return { content: [{ type: "text" as const, text }] }
  },
)

// ── Start server ──

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(console.error)
