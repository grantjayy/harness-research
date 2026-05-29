// Harness Research MCP Server — Multi-source Search Engine
// 5 data sources: Tavily, Brave, arXiv, PubMed, Tushare

import * as cheerio from "cheerio"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import type { SearchResult } from "../utils/types.js"
import { sleep } from "../utils/json.js"
import { SEARCH_TIMEOUT } from "../utils/config.js"

// ── Tavily Search ──

export async function searchTavily(keywords: string[]): Promise<SearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) return []

  const results: SearchResult[] = []
  for (const kw of keywords.slice(0, 4)) {
    try {
      const resp = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query: kw,
          max_results: 5,
          include_raw_content: false,
          search_depth: "advanced",
          days: 365,
        }),
        signal: AbortSignal.timeout(SEARCH_TIMEOUT),
      })
      if (!resp.ok) continue
      const data = (await resp.json()) as any
      for (const r of data.results || []) {
        results.push({
          title: r.title || "",
          url: r.url || "",
          snippet: (r.content || "").slice(0, 500),
          source: "tavily",
          published_date: r.published_date || "",
        })
      }
      await sleep(200)
    } catch {
      // Silent fail — search degradation is expected
    }
  }
  return results
}

// ── Brave Search ──

export async function searchBrave(keywords: string[]): Promise<SearchResult[]> {
  const apiKey = process.env.BRAVE_API_KEY
  if (!apiKey) return []

  const results: SearchResult[] = []
  for (const kw of keywords.slice(0, 4)) {
    try {
      const params = new URLSearchParams({ q: kw, count: "5", freshness: "py" })
      const resp = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
        headers: { "X-Subscription-Token": apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(SEARCH_TIMEOUT),
      })
      if (!resp.ok) continue
      const data = (await resp.json()) as any
      for (const r of data.web?.results || []) {
        results.push({
          title: r.title || "",
          url: r.url || "",
          snippet: (r.description || "").slice(0, 500),
          source: "brave",
          published_date: r.age || "",
        })
      }
      await sleep(500)
    } catch {
      // Silent fail
    }
  }
  return results
}

// ── arXiv Search ──

export async function searchArxiv(keywords: string[]): Promise<SearchResult[]> {
  const results: SearchResult[] = []
  try {
    const query = keywords.slice(0, 5).join(" OR ")
    const params = new URLSearchParams({
      search_query: `all:${query}`,
      start: "0",
      max_results: "10",
      sortBy: "submittedDate",
      sortOrder: "descending",
    })

    const resp = await fetch(`http://export.arxiv.org/api/query?${params}`, {
      signal: AbortSignal.timeout(SEARCH_TIMEOUT),
    })
    if (!resp.ok) return []

    const xml = await resp.text()
    const entries = xml.split("<entry>").slice(1)
    for (const entry of entries) {
      const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim().replace(/\n/g, " ")
      const summary = entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim().replace(/\n/g, " ")
      const id = entry.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim()
      const published = entry.match(/<published>([\s\S]*?)<\/published>/)?.[1]?.trim()

      if (title && id) {
        results.push({
          title,
          url: id,
          snippet: (summary || "").slice(0, 500),
          source: "arxiv",
          published_date: published || "",
        })
      }
    }
  } catch {
    // Silent fail
  }
  return results
}

// ── PubMed Search ──

export async function searchPubmed(keywords: string[]): Promise<SearchResult[]> {
  const results: SearchResult[] = []
  try {
    const query = keywords.slice(0, 3).join(" OR ")
    const searchParams = new URLSearchParams({
      db: "pubmed",
      term: query,
      retmax: "10",
      retmode: "json",
      sort: "date",
    })
    const searchResp = await fetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${searchParams}`,
      { signal: AbortSignal.timeout(SEARCH_TIMEOUT) },
    )
    if (!searchResp.ok) return []
    const searchData = (await searchResp.json()) as any
    const ids: string[] = searchData.esearchresult?.idlist || []
    if (ids.length === 0) return []

    const summaryParams = new URLSearchParams({
      db: "pubmed",
      id: ids.join(","),
      retmode: "json",
    })
    const summaryResp = await fetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?${summaryParams}`,
      { signal: AbortSignal.timeout(SEARCH_TIMEOUT) },
    )
    if (!summaryResp.ok) return []
    const summaryData = (await summaryResp.json()) as any

    for (const id of ids) {
      const doc = summaryData.result?.[id]
      if (!doc) continue
      results.push({
        title: doc.title || "",
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        snippet: doc.title || "",
        source: "pubmed",
        published_date: doc.pubdate || "",
      })
    }
  } catch {
    // Silent fail
  }
  return results
}

// ── Tushare Financial Data ──

function convertToTushareCode(code: string): string {
  const lower = code.toLowerCase()
  if (lower.startsWith("sh")) return code.slice(2) + ".SH"
  if (lower.startsWith("sz")) return code.slice(2) + ".SZ"
  if (lower.includes(".")) return code.toUpperCase()
  return code + ".SH"
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
}

function getLatestQuarter(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  if (month <= 3) return `${year - 1}1231`
  if (month <= 6) return `${year}0331`
  if (month <= 9) return `${year}0630`
  return `${year}0930`
}

export async function searchTushare(financeContext: any): Promise<SearchResult[]> {
  const token = process.env.TUSHARE_TOKEN
  if (!token || !financeContext?.stock_codes?.length) return []

  const results: SearchResult[] = []

  for (const code of (financeContext.stock_codes as string[]).slice(0, 3)) {
    const tsCode = convertToTushareCode(code)

    for (const dataType of (financeContext.data_types || ["quote"]) as string[]) {
      try {
        let apiName = "daily"
        const params: Record<string, string> = { ts_code: tsCode }

        if (dataType === "income") {
          apiName = "income"
          params.period = getLatestQuarter()
        } else if (dataType === "balancesheet") {
          apiName = "balancesheet"
          params.period = getLatestQuarter()
        } else {
          apiName = "daily"
          const today = new Date()
          const sixMonthsAgo = new Date(today.getTime() - 180 * 86400000)
          params.start_date = formatDate(sixMonthsAgo)
          params.end_date = formatDate(today)
        }

        const resp = await fetch("http://api.tushare.pro", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_name: apiName,
            token,
            params,
            fields: "",
          }),
          signal: AbortSignal.timeout(SEARCH_TIMEOUT),
        })

        if (!resp.ok) continue
        const data = (await resp.json()) as any

        if (data.data?.items?.length > 0) {
          results.push({
            title: `${tsCode} ${apiName} data`,
            url: `https://tushare.pro/document/2?doc_id=${apiName}`,
            snippet: JSON.stringify(data.data.items.slice(0, 5)),
            source: "tushare",
            published_date: new Date().toISOString().split("T")[0],
            structured_data: {
              fields: data.data.fields,
              items: data.data.items.slice(0, 20),
            },
          })
        }
      } catch {
        // Silent fail
      }
    }
  }
  return results
}

export interface SourceSearchOptions {
  limit?: number
  sort?: "relevance" | "hot" | "top" | "new" | "comments"
  time_filter?: "hour" | "day" | "week" | "month" | "year" | "all"
  subreddit?: string
  include_transcripts?: boolean
}

function limitPerQuery(options?: SourceSearchOptions, fallback = 5): number {
  const n = Number(options?.limit || fallback)
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 25) : fallback
}

function compactText(text: string, max = 1000): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max)
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

export async function searchReddit(
  keywords: string[],
  options: SourceSearchOptions = {},
): Promise<SearchResult[]> {
  const results: SearchResult[] = []
  const limit = limitPerQuery(options)

  for (const kw of keywords.slice(0, 4)) {
    try {
      const params = new URLSearchParams({
        q: kw,
        limit: String(limit),
        sort: options.sort || "relevance",
        t: options.time_filter || "year",
        raw_json: "1",
      })
      const base = options.subreddit
        ? `https://www.reddit.com/r/${encodeURIComponent(options.subreddit)}/search.json`
        : "https://www.reddit.com/search.json"
      const resp = await fetch(`${base}?${params}`, {
        headers: { "User-Agent": "harness-research-mcp/2.0" },
        signal: AbortSignal.timeout(SEARCH_TIMEOUT),
      })
      if (!resp.ok) continue
      const data = (await resp.json()) as any
      for (const child of data.data?.children || []) {
        const post = child.data || {}
        const permalink = post.permalink || ""
        const url = permalink.startsWith("http") ? permalink : `https://www.reddit.com${permalink}`
        const text = compactText(post.selftext || post.url || "", 650)
        results.push({
          title: post.title || "Reddit result",
          url,
          snippet: compactText(
            `r/${post.subreddit || "unknown"} | score: ${post.score ?? "n/a"} | comments: ${post.num_comments ?? "n/a"}. ${text}`,
            900,
          ),
          source: "reddit",
          published_date: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : "",
          structured_data: {
            subreddit: post.subreddit,
            score: post.score,
            comments: post.num_comments,
            author: post.author,
          },
        })
      }
      await sleep(250)
    } catch {
      // Public Reddit JSON can rate-limit or block; degrade silently like other sources.
    }
  }

  return results
}

export async function readRedditPost(urlOrId: string): Promise<SearchResult[]> {
  try {
    const url = urlOrId.startsWith("http")
      ? `${urlOrId.replace(/\/?$/, "")}.json?raw_json=1`
      : `https://www.reddit.com/comments/${encodeURIComponent(urlOrId)}.json?raw_json=1`
    const resp = await fetch(url, {
      headers: { "User-Agent": "harness-research-mcp/2.0" },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT),
    })
    if (!resp.ok) return []
    const data = (await resp.json()) as any[]
    const post = data?.[0]?.data?.children?.[0]?.data
    if (!post) return []
    const comments = (data?.[1]?.data?.children || [])
      .map((c: any) => c.data?.body)
      .filter(Boolean)
      .slice(0, 20)
      .join("\n\n")
    return [{
      title: post.title || "Reddit post",
      url: post.permalink?.startsWith("http") ? post.permalink : `https://www.reddit.com${post.permalink || ""}`,
      snippet: compactText(`${post.selftext || ""}\n\nTop comments:\n${comments}`, 1600),
      source: "reddit",
      published_date: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : "",
      structured_data: { score: post.score, comments: post.num_comments, subreddit: post.subreddit },
    }]
  } catch {
    return []
  }
}

export async function searchYoutube(
  keywords: string[],
  options: SourceSearchOptions = {},
): Promise<SearchResult[]> {
  const apiKey = process.env.YOUTUBE_API_KEY || process.env.YOUTUBE_DATA_API_KEY
  if (!apiKey) return []

  const results: SearchResult[] = []
  const limit = limitPerQuery(options)
  for (const kw of keywords.slice(0, 4)) {
    try {
      const params = new URLSearchParams({
        part: "snippet",
        type: "video",
        q: kw,
        maxResults: String(limit),
        order: "relevance",
        key: apiKey,
      })
      const resp = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, {
        signal: AbortSignal.timeout(SEARCH_TIMEOUT),
      })
      if (!resp.ok) continue
      const data = (await resp.json()) as any
      for (const item of data.items || []) {
        const videoId = item.id?.videoId
        if (!videoId) continue
        const snippet = item.snippet || {}
        const transcript = options.include_transcripts ? await fetchYoutubeTranscript(videoId) : ""
        results.push({
          title: snippet.title || "YouTube video",
          url: `https://www.youtube.com/watch?v=${videoId}`,
          snippet: compactText(
            `Channel: ${snippet.channelTitle || "unknown"}. ${snippet.description || ""}${transcript ? ` Transcript: ${transcript}` : ""}`,
            transcript ? 1800 : 900,
          ),
          source: transcript ? "youtube_transcript" : "youtube",
          published_date: snippet.publishedAt || "",
          structured_data: { video_id: videoId, channel: snippet.channelTitle, transcript_available: !!transcript },
        })
      }
      await sleep(250)
    } catch {
      // Silent fail
    }
  }
  return results
}

export async function fetchYoutubeTranscript(videoIdOrUrl: string): Promise<string> {
  const videoId = extractYoutubeVideoId(videoIdOrUrl)
  if (!videoId) return ""
  try {
    const watchResp = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
      signal: AbortSignal.timeout(SEARCH_TIMEOUT),
    })
    if (!watchResp.ok) return ""
    const watchHtml = await watchResp.text()
    const match = watchHtml.match(/"captionTracks":(\[.*?\]),"audioTracks"/)
    if (!match) return ""
    const tracks = JSON.parse(match[1].replace(/\\u0026/g, "&")) as Array<{ baseUrl: string; languageCode?: string }>
    const track = tracks.find(t => t.languageCode?.startsWith("en")) || tracks[0]
    if (!track?.baseUrl) return ""
    const transcriptResp = await fetch(track.baseUrl, { signal: AbortSignal.timeout(SEARCH_TIMEOUT) })
    if (!transcriptResp.ok) return ""
    const xml = await transcriptResp.text()
    const pieces = Array.from(xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)).map(m => decodeHtml(m[1]))
    return compactText(pieces.join(" "), 6000)
  } catch {
    return ""
  }
}

function extractYoutubeVideoId(value: string): string {
  const trimmed = value.trim()
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed
  try {
    const url = new URL(trimmed)
    if (url.hostname.includes("youtu.be")) return url.pathname.slice(1)
    return url.searchParams.get("v") || ""
  } catch {
    return ""
  }
}

export async function searchX(
  keywords: string[],
  options: SourceSearchOptions = {},
): Promise<SearchResult[]> {
  const creds = resolveXaiCredentials()
  if (!creds?.apiKey) return []
  const results: SearchResult[] = []

  for (const kw of keywords.slice(0, limitPerQuery(options, 2))) {
    try {
      const prompt = `Search X deeply for posts, threads, replies, demos, screenshots, and practitioner discussions about: ${kw}.

Research objective: collect concrete, recent social evidence for a deep research report.

Return common patterns, named tools/accounts, specific implementation details, complaints/failure modes, disagreements, concrete post URLs when possible, and claims that need corroboration. Use semantic search; do not treat this as strict Boolean syntax.`
      const resp = await fetch(`${creds.baseUrl.replace(/\/$/, "")}/responses`, {
        method: "POST",
        headers: { Authorization: `Bearer ${creds.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.XAI_SEARCH_MODEL || "grok-4.3",
          input: [{ role: "user", content: prompt }],
          tools: [{ type: "x_search" }],
          store: false,
        }),
        signal: AbortSignal.timeout(60_000),
      })
      if (!resp.ok) continue
      const data = (await resp.json()) as any
      const content = extractXResponseText(data) || JSON.stringify(data).slice(0, 1800)
      if (!content) continue
      results.push({
        title: `X research synthesis: ${kw}`,
        url: "https://x.com/search",
        snippet: compactText(content, 1800),
        source: "x",
        published_date: new Date().toISOString(),
        structured_data: { query: kw, credential_source: creds.source, citations: data.citations || [] },
      })
    } catch {
      // Silent fail
    }
  }
  return results
}

function resolveXaiCredentials(): { apiKey: string; baseUrl: string; source: string } | null {
  const apiKey = process.env.XAI_API_KEY || ""
  if (apiKey) return { apiKey, baseUrl: process.env.XAI_BASE_URL || "https://api.x.ai/v1", source: "xai" }

  // Fall back to Hermes-managed SuperGrok OAuth when Grant's Hermes setup uses
  // OAuth instead of a raw XAI_API_KEY.
  try {
    const hermesAgentPath = `${process.env.HOME || ""}/.hermes/hermes-agent`
    const output = execFileSync(resolveHermesPython(hermesAgentPath), ["-c", `
import json, os, sys
sys.path.insert(0, os.path.expanduser("~/.hermes/hermes-agent"))
from tools.xai_http import resolve_xai_http_credentials
creds = resolve_xai_http_credentials()
print(json.dumps({
    "apiKey": creds.get("api_key", ""),
    "baseUrl": creds.get("base_url", "https://api.x.ai/v1"),
    "source": creds.get("provider", "xai"),
}))
`], {
      env: { ...process.env, PYTHONPATH: hermesAgentPath },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 20_000,
    }).trim()
    const parsed = JSON.parse(output)
    if (parsed?.apiKey) {
      return { apiKey: parsed.apiKey, baseUrl: parsed.baseUrl || "https://api.x.ai/v1", source: parsed.source || "xai" }
    }
  } catch {
    // Fall through to XAI_API_KEY.
  }
  return null
}

function resolveHermesPython(hermesAgentPath: string): string {
  for (const candidate of [
    `${hermesAgentPath}/.venv/bin/python`,
    `${hermesAgentPath}/venv/bin/python`,
    "python3",
  ]) {
    if (candidate === "python3" || fs.existsSync(candidate)) return candidate
  }
  return "python3"
}

function extractXResponseText(data: any): string {
  if (typeof data?.output_text === "string") return data.output_text
  const chunks: string[] = []
  const visit = (value: any) => {
    if (!value) return
    if (typeof value === "string") return
    if (Array.isArray(value)) return value.forEach(visit)
    if (typeof value !== "object") return
    if (typeof value.text === "string") chunks.push(value.text)
    if (typeof value.content === "string") chunks.push(value.content)
    if (Array.isArray(value.content)) visit(value.content)
    if (Array.isArray(value.output)) visit(value.output)
  }
  visit(data?.output)
  return chunks.join("\n").trim()
}

export async function extractWebPages(urls: string[]): Promise<SearchResult[]> {
  const results: SearchResult[] = []
  for (const url of urls.slice(0, 10)) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(SEARCH_TIMEOUT) })
      if (!resp.ok) continue
      const html = await resp.text()
      const $ = cheerio.load(html)
      $("script, style, noscript, svg").remove()
      const title = compactText($("title").first().text() || $("h1").first().text() || url, 160)
      const body = compactText($("body").text(), 2200)
      results.push({
        title,
        url,
        snippet: body,
        source: "web_extract",
        published_date: "",
      })
    } catch {
      // Silent fail
    }
  }
  return results
}
