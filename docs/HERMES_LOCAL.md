# Local Hermes setup for modified deep-research MCP

This fork is intended to run locally from source/build output behind Grant's lazy-mcp server. It does not need to be published to npm.

## Purpose

This MCP is specifically a deep research tool. It is not a generic search MCP and it should not expose standalone search/read/extract tools to Hermes.

The top-level MCP contract is intentionally minimal:

```json
{
  "topic": "Deep research topic"
}
```

No source selection, model selection, output format, URL list, section caps, source caps, or output directory should be exposed to Hermes.

The research model is fixed internally: Kimi K2.6 through Alloy Runtime using the Fireworks AI provider route:

```text
fireworks-ai/accounts/fireworks/models/kimi-k2p6
```

The X/Twitter search agent is fixed internally to Grok 4.3 unless overridden by `XAI_SEARCH_MODEL`.

Top-level tool exposed by the MCP:

- `deep_research`

All source work happens internally inside that tool.

## Internal source integrations

Every research run uses the standard internal source set. Sources degrade gracefully if optional credentials or remote endpoints are unavailable.

Internal source integrations include:

- Tavily web search when `TAVILY_API_KEY` is available
- Brave web search when `BRAVE_API_KEY` is available
- arXiv
- PubMed
- Tushare finance data when the generated plan identifies finance context and `TUSHARE_TOKEN` is available
- Reddit public JSON search
- YouTube search through YouTube Data API when `YOUTUBE_API_KEY` or `YOUTUBE_DATA_API_KEY` is available
- YouTube caption/transcript ingestion whenever transcripts are available
- X/Twitter search synthesis through xAI Grok with `tools: [{ type: "x_search" }]`
- Direct web extraction from discovered web result URLs

Hermes does not pass source lists or URLs. The MCP owns source discovery and extraction.

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

Server entry in `/Users/grantjordan/.config/lazy-mcp/servers.json`:

```json
{
  "name": "deep-research",
  "description": "Local fork of harness-research exposed as one topic-only deep_research tool. It runs internal multi-source research and returns the finished Markdown report inline.",
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

The server loads credentials from `~/.harness-research/.env` first, then fills any missing keys from Hermes Agent's standard secret stores, without exposing secret values to the model context:

1. `~/.harness-research/.env`
2. `~/.hermes/.env`
3. `~/.hermes/hermes.env`
4. legacy OpenCode research env path

Use these names:

```bash
ALLOY_RUNTIME_API_URL=...
ALLOY_RUNTIME_API_KEY=...
TAVILY_API_KEY=...
BRAVE_API_KEY=...
YOUTUBE_API_KEY=...
YOUTUBE_DATA_API_KEY=...
XAI_API_KEY=...
TUSHARE_TOKEN=...
NCBI_API_KEY=...
```

Minimum for research reports:

- `ALLOY_RUNTIME_API_URL`
- `ALLOY_RUNTIME_API_KEY`

Optional expanded-source notes:

- `TAVILY_API_KEY` or `BRAVE_API_KEY` strengthens general web search.
- `YOUTUBE_API_KEY` or `YOUTUBE_DATA_API_KEY` enables YouTube search. Transcript fetch uses public captions when available.
- `XAI_API_KEY` enables X/Twitter search synthesis. If it is absent, the local fork falls back to Hermes-managed xAI Grok OAuth / SuperGrok credentials from the Hermes auth store.
- Reddit search uses Reddit public JSON endpoints and does not require OAuth.

## Tool contract

`deep_research` runs the full pipeline synchronously from the MCP client's perspective:

1. Receive `topic` only.
2. Generate a research plan from the topic.
3. Search the fixed internal source set.
4. Deduplicate results.
5. Automatically extract discovered web result URLs.
6. Evaluate sources with CRAAP-style source evaluation.
7. Cross-verify findings.
8. Write the report.
9. Return the finished Markdown report inline as the MCP tool output.

Important: configure lazy-mcp / MCP client timeout high enough for full research runs, usually 1200 seconds.

## Example call

```json
{
  "topic": "Current best practices for AI agent memory systems"
}
```

## Notes

- Output is always Markdown returned inline. The MCP should not require or expose `output_dir`.
- Search helpers remain internal implementation details. Do not expose them as top-level MCP tools unless Grant changes the product direction.
- Do not add top-level parameters for source selection, formats, section limits, source limits, transcript toggles, URLs, providers, models, temperature, token limits, reasoning controls, or OpenRouter.
