# Local Hermes setup for modified deep-research MCP

This fork is intended to run locally from source/build output behind Grant's lazy-mcp server. It does not need to be published to npm.

## Purpose

This MCP is specifically a deep research tool. It is not a generic search MCP and it should not expose standalone search/read/extract tools to Hermes.

The research model is fixed internally: Kimi K2.6 via OpenRouter (`moonshotai/kimi-k2.6`). Hermes should not select arbitrary LLM providers/models for this MCP.

Top-level tool exposed by the MCP:

- `deep_research`

All source work happens internally inside that tool.

## Internal source integrations

The `deep_research` tool owns these source integrations internally:

- Web search through Tavily and Brave
- Academic search through arXiv and PubMed
- Financial search through Tushare when the generated plan needs finance data
- Reddit search
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

## Lazy MCP config

All MCP servers for Grant's Hermes setup should be configured under lazy-mcp, not directly under Hermes `mcp_servers` except for the lazy-mcp aggregator itself.

Add this server entry to `/Users/grantjordan/.config/lazy-mcp/servers.json` inside the `servers` array:

```json
{
  "name": "deep-research",
  "description": "Local fork of harness-research exposed as one top-level deep_research tool. Internal source integrations include web, academic, Reddit, YouTube/transcripts, X/Twitter, direct URL extraction, and finance when relevant.",
  "command": [
    "node",
    "/Users/grantjordan/programs/0_projects/harness-research/dist/index.js"
  ],
  "timeout": 1200000
}
```

Hermes should continue to have only the lazy-mcp aggregator in `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  lazy-mcp:
    command: /Users/grantjordan/.local/bin/lazy-mcp
    args:
      - --config
      - /Users/grantjordan/.config/lazy-mcp/servers.json
    enabled: true
    timeout: 180
    connect_timeout: 60
```

Restart Hermes/gateway only when Grant approves or does it himself.

## Credentials

The server loads credentials from `~/.harness-research/.env` first, then fills any missing keys from Hermes Agent's standard `~/.hermes/.env`, without exposing secret values to the model context. Use these names:

```bash
TAVILY_API_KEY=...
BRAVE_API_KEY=...
OPENROUTER_API_KEY=...
YOUTUBE_API_KEY=...
XAI_API_KEY=...
TUSHARE_TOKEN=...
NCBI_API_KEY=...
```

Minimum for full research reports: `OPENROUTER_API_KEY`. The MCP calls Kimi through OpenRouter using model `moonshotai/kimi-k2.6`; direct `KIMI_API_KEY` is not used by the deep research tool. Web search keys (`TAVILY_API_KEY` or `BRAVE_API_KEY`) are optional but recommended; without them the run relies on the other available internal sources such as Reddit, YouTube, X, academic sources, and direct URLs.

Optional expanded-source keys:

- `YOUTUBE_API_KEY` or `YOUTUBE_DATA_API_KEY` enables YouTube search. Transcript fetch uses public captions when available.
- `XAI_API_KEY` enables X/Twitter search synthesis. If it is absent, the local fork falls back to Hermes-managed xAI Grok OAuth / SuperGrok credentials from the Hermes auth store.
- Reddit search uses Reddit public JSON endpoints and does not require OAuth.

## Tool contract

`deep_research` runs the full pipeline synchronously from the MCP client's perspective:

1. Generate a research plan from the topic.
2. Search enabled internal source classes.
3. Deduplicate results.
4. Evaluate sources with CRAAP-style source evaluation.
5. Cross-verify findings.
6. Write the report and render artifacts.
7. Return output file paths, source stats, and summary.

Important: configure lazy-mcp / MCP client timeout high enough for full research runs, usually 1200 seconds.

## Example call

```json
{
  "topic": "Current best practices for AI agent memory systems",
  "sources": ["tavily", "brave", "arxiv", "reddit", "youtube", "x", "web_extract"],
  "include_youtube_transcripts": true,
  "formats": ["html", "docx"],
  "max_sections": 3,
  "max_sources": 25
}
```

For a quick live smoke test, constrain the report while still exercising the full synchronous MCP path:

```json
{
  "topic": "Smoke test: is Tavily useful for MCP deep research agents?",
  "sources": ["tavily"],
  "web_queries": ["Tavily MCP deep research agents source integration"],
  "formats": ["markdown"],
  "max_sections": 1,
  "max_sources": 3
}
```

## Notes

- The server degrades gracefully when an optional source key is missing. For X/Twitter, a raw `XAI_API_KEY` is optional in Grant's Hermes setup because the local fork can fall back to Hermes-managed xAI Grok OAuth / SuperGrok credentials. If neither credential path is available, X returns no results while other sources still run.
- Output files are written to the requested `output_dir` or the MCP process working directory.
- Search helpers remain internal implementation details. Do not expose them as top-level MCP tools unless Grant changes the product direction.
