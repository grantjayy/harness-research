import assert from "node:assert/strict"
import test from "node:test"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

test("MCP exposes exactly one top-level deep research tool", async () => {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["--import", "tsx", "src/index.ts"],
  })
  const client = new Client({ name: "surface-test", version: "1.0.0" })

  try {
    await client.connect(transport)
    const tools = await client.listTools()
    assert.deepEqual(tools.tools.map(t => t.name), ["deep_research"])

    const deepResearch = tools.tools[0]
    const inputKeys = Object.keys(deepResearch.inputSchema?.properties || {})
    assert.ok(inputKeys.includes("topic"))
    assert.ok(inputKeys.includes("sources"))
    assert.ok(!inputKeys.includes("query"), "top-level tool should not look like a generic search tool")
  } finally {
    await client.close()
  }
})
