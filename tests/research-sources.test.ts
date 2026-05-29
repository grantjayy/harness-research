import assert from "node:assert/strict"
import test from "node:test"

import {
  extractWebPages,
  searchReddit,
  searchX,
  searchYoutube,
} from "../src/core/search.js"
import { buildSourceQueries } from "../src/core/source-params.js"

test("buildSourceQueries expands one query into source-specific defaults", () => {
  const queries = buildSourceQueries({ query: "agent memory tools" })

  assert.deepEqual(queries.web, ["agent memory tools"])
  assert.deepEqual(queries.reddit, ["agent memory tools reddit discussion"])
  assert.deepEqual(queries.youtube, ["agent memory tools tutorial demo"])
  assert.deepEqual(queries.x, ["agent memory tools"])
})

test("buildSourceQueries honors explicit source-specific query arrays", () => {
  const queries = buildSourceQueries({
    query: "fallback",
    web_queries: ["web one", "web two"],
    reddit_queries: ["reddit one"],
    youtube_queries: ["youtube one"],
    x_queries: ["x one"],
  })

  assert.deepEqual(queries.web, ["web one", "web two"])
  assert.deepEqual(queries.reddit, ["reddit one"])
  assert.deepEqual(queries.youtube, ["youtube one"])
  assert.deepEqual(queries.x, ["x one"])
})

test("searchReddit reads public JSON search results without OAuth", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    assert.match(url, /^https:\/\/www\.reddit\.com\/search\.json\?/) 
    assert.match(url, /q=agent\+memory/)
    return new Response(JSON.stringify({
      data: {
        children: [
          { data: {
            title: "Useful Reddit thread",
            permalink: "/r/LocalLLaMA/comments/abc/useful/",
            selftext: "A detailed practitioner discussion",
            subreddit: "LocalLLaMA",
            score: 42,
            num_comments: 7,
            created_utc: 1700000000,
          } },
        ],
      },
    }), { status: 200 })
  }) as typeof fetch

  try {
    const results = await searchReddit(["agent memory"], { limit: 3 })
    assert.equal(results.length, 1)
    assert.equal(results[0].source, "reddit")
    assert.equal(results[0].title, "Useful Reddit thread")
    assert.equal(results[0].url, "https://www.reddit.com/r/LocalLLaMA/comments/abc/useful/")
    assert.match(results[0].snippet, /score: 42/i)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("searchYoutube uses YouTube Data API results when YOUTUBE_API_KEY is set", async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.YOUTUBE_API_KEY
  process.env.YOUTUBE_API_KEY = "test-youtube-key"

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    assert.match(url, /^https:\/\/www\.googleapis\.com\/youtube\/v3\/search\?/) 
    assert.match(url, /q=agent\+memory/)
    assert.match(url, /key=test-youtube-key/)
    return new Response(JSON.stringify({
      items: [
        {
          id: { videoId: "abc123xyz00" },
          snippet: {
            title: "Agent Memory Demo",
            description: "A practical walkthrough",
            channelTitle: "Builder Channel",
            publishedAt: "2026-01-02T00:00:00Z",
          },
        },
      ],
    }), { status: 200 })
  }) as typeof fetch

  try {
    const results = await searchYoutube(["agent memory"], { limit: 2 })
    assert.equal(results.length, 1)
    assert.equal(results[0].source, "youtube")
    assert.equal(results[0].url, "https://www.youtube.com/watch?v=abc123xyz00")
    assert.match(results[0].snippet, /Builder Channel/)
  } finally {
    if (originalKey === undefined) delete process.env.YOUTUBE_API_KEY
    else process.env.YOUTUBE_API_KEY = originalKey
    globalThis.fetch = originalFetch
  }
})

test("extractWebPages turns HTML into text snippets", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(`
    <html><head><title>Example Page</title><script>bad()</script></head>
    <body><h1>Main heading</h1><p>This is the useful paragraph for extraction.</p></body></html>
  `, { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch

  try {
    const results = await extractWebPages(["https://example.com/page"])
    assert.equal(results.length, 1)
    assert.equal(results[0].source, "web_extract")
    assert.equal(results[0].title, "Example Page")
    assert.match(results[0].snippet, /Main heading/)
    assert.doesNotMatch(results[0].snippet, /bad\(\)/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("searchX sends a deep-search prompt to xAI when XAI_API_KEY is set", async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.XAI_API_KEY
  process.env.XAI_API_KEY = "test-xai-key"

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), "https://api.x.ai/v1/responses")
    const body = JSON.parse(String(init?.body))
    assert.match(body.input[0].content, /Search X deeply/)
    assert.match(body.input[0].content, /agent memory/)
    assert.deepEqual(body.tools, [{ type: "x_search" }])
    return new Response(JSON.stringify({
      output_text: "Found posts about agent memory workflows and implementation caveats.",
      citations: ["https://x.com/example/status/1"],
    }), { status: 200 })
  }) as typeof fetch

  try {
    const results = await searchX(["agent memory"], { limit: 1 })
    assert.equal(results.length, 1)
    assert.equal(results[0].source, "x")
    assert.match(results[0].snippet, /implementation caveats/)
  } finally {
    if (originalKey === undefined) delete process.env.XAI_API_KEY
    else process.env.XAI_API_KEY = originalKey
    globalThis.fetch = originalFetch
  }
})
