# Local Hermes setup for modified harness-research

This fork is intended to run locally from source/build output. It does not need to be published to npm.

## What this fork adds

The MCP now owns the expanded research-source integrations directly:

- Web search through Tavily and Brave
- Academic search through arXiv and PubMed
- Financial search through Tushare when the generated plan needs finance data
- Reddit search and Reddit post reading
- YouTube search and optional caption/transcript ingestion
- X/Twitter search synthesis through xAI
- Direct URL extraction through `web_extract`
- Source-specific query parameters for web, Reddit, YouTube, X, and direct URLs

## Build and verify

From the repo root:

```bash
npm install
npm run check
npm test
npm run build
```

## Hermes MCP config

Add this to `~/.hermes/config.yaml` under `mcp_servers`:

```yaml
mcp_servers:
  harness_research:
    command: "node"
    args:
      - "/Users/grantjordan/programs/0_projects/harness-research/dist/index.js"
    timeout: 1200
    connect_timeout: 60
```

Then restart Hermes/gateway when ready. Do not restart the gateway from an agent session unless Grant explicitly approves it.

## Credentials

The server loads credentials from `~/.harness-research/.env` without needing them in Hermes model context. Use these names:

```bash
TAVILY_API_KEY=...
BRAVE_API_KEY=...
KIMI_API_KEY=...
OPENROUTER_API_KEY=...
YOUTUBE_API_KEY=...
XAI_API_KEY=...
TUSHARE_TOKEN=...
NCBI_API_KEY=...
```

Minimum for full research reports: one search key (`TAVILY_API_KEY` or `BRAVE_API_KEY`) and one LLM key (`KIMI_API_KEY` or `OPENROUTER_API_KEY`).

Optional expanded-source keys:

- `YOUTUBE_API_KEY` enables YouTube search. Transcript fetch uses public captions when available.
- `XAI_API_KEY` enables X/Twitter search synthesis.
- Reddit search/read uses Reddit public JSON endpoints and does not require OAuth.

## MCP tools

- `harness_research` - asynchronous full research report. Returns a task ID immediately.
- `harness_status` - poll task progress and output paths.
- `harness_search` - quick multi-source search with source-specific query arrays.
- `harness_read_reddit` - read one Reddit post and top comments.
- `harness_youtube_transcript` - fetch available captions/transcript text for one YouTube URL or video ID.
- `harness_extract_web` - extract readable text from URLs.

## Example calls

Quick multi-source search:

```json
{
  "query": "best MCP server research workflows",
  "sources": ["brave", "reddit", "youtube", "x"],
  "reddit_queries": ["MCP server research workflow reddit discussion"],
  "youtube_queries": ["MCP server research workflow demo"],
  "x_queries": ["Search X for practitioner examples of MCP research server workflows and caveats."],
  "include_youtube_transcripts": true,
  "limit": 5
}
```

Full research:

```json
{
  "topic": "Current best practices for AI agent memory systems",
  "sources": ["tavily", "brave", "arxiv", "reddit", "youtube", "x", "web_extract"],
  "include_youtube_transcripts": true,
  "formats": ["html", "docx"]
}
```

## Notes

- The server degrades gracefully when an optional source key is missing. For example, no `XAI_API_KEY` means X source returns no results, while other sources still run.
- `harness_research` is async by design. Hermes should poll `harness_status` every 30-60 seconds until the task is completed or failed.
- Output files are written to the requested `output_dir` or the MCP process working directory.
