// Harness Research MCP Server — 6-Step Research Pipeline
// Orchestrates the full deep research workflow and returns Markdown inline.

import type {
  ResearchPlan,
  ResearchStats,
  ResearchTask,
  SearchResult,
} from "../utils/types.js"
import { MAX_SOURCES } from "../utils/config.js"
import { safeJsonParse } from "../utils/json.js"
import { loadPrompt } from "../utils/prompts.js"
import { createLLMConfig, callLLM } from "./llm.js"
import {
  searchTavily,
  searchBrave,
  searchArxiv,
  searchPubmed,
  searchTushare,
  searchReddit,
  searchYoutube,
  searchX,
  extractWebPages,
} from "./search.js"
import { buildSourceQueries } from "./source-params.js"
import { dedup } from "./dedup.js"
import { evaluateSources } from "./craap.js"
import { verify } from "./verify.js"
import { writeSections, writeExecSummary } from "./write.js"
import {
  generateReferencesHtml,
  mergeHtml,
  sanitizeHtml,
  htmlToMarkdown,
} from "./render-html.js"

/** In-memory task store for progress tracking */
const tasks = new Map<string, ResearchTask>()

export function getTask(id: string): ResearchTask | undefined {
  return tasks.get(id)
}

export function getAllTasks(): ResearchTask[] {
  return Array.from(tasks.values())
}

/**
 * Start research in the background (fire-and-forget).
 * Kept for internal compatibility only; the MCP surface is synchronous.
 */
export function startResearchBackground(topic: string): string {
  const taskId = `research-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const task: ResearchTask = {
    id: taskId,
    topic,
    status: "running",
    step: "initializing",
    progress: 0,
    startTime: Date.now(),
  }
  tasks.set(taskId, task)

  runResearch(topic, undefined, taskId).catch(() => {
    // Error is already captured in the task object by runResearch.
  })

  return taskId
}

/** Progress callback type */
type ProgressCallback = (step: string, progress: number, detail: string) => void

function sourceStatsTemplate(): ResearchStats {
  return {
    tavily: { queries: 0, results: 0 },
    brave: { queries: 0, results: 0 },
    arxiv: { queries: 0, results: 0 },
    pubmed: { queries: 0, results: 0 },
    tushare: { queries: 0, results: 0 },
    reddit: { queries: 0, results: 0 },
    youtube: { queries: 0, results: 0 },
    youtube_transcript: { queries: 0, results: 0 },
    x: { queries: 0, results: 0 },
    web_extract: { queries: 0, results: 0 },
    totalSources: 0,
    rejectedSources: 0,
    tierDistribution: {},
  }
}

function countSourceStats(stats: ResearchStats, results: SearchResult[]): void {
  for (const r of results) {
    if (r.source === "tavily") stats.tavily.results++
    else if (r.source === "brave") stats.brave.results++
    else if (r.source === "arxiv") stats.arxiv.results++
    else if (r.source === "pubmed") stats.pubmed.results++
    else if (r.source === "tushare") stats.tushare.results++
    else if (r.source === "reddit") stats.reddit.results++
    else if (r.source === "youtube") stats.youtube.results++
    else if (r.source === "youtube_transcript") stats.youtube_transcript.results++
    else if (r.source === "x") stats.x.results++
    else if (r.source === "web_extract") stats.web_extract.results++
  }
}

function extractableUrls(results: SearchResult[]): string[] {
  const skipHosts = ["youtube.com", "youtu.be", "reddit.com", "x.com", "twitter.com", "arxiv.org", "pubmed.ncbi.nlm.nih.gov"]
  const urls: string[] = []
  for (const r of results) {
    try {
      const u = new URL(r.url)
      if (!u.protocol.startsWith("http")) continue
      if (skipHosts.some(host => u.hostname.includes(host))) continue
      if (!urls.includes(r.url)) urls.push(r.url)
    } catch {
      // Ignore malformed source URLs.
    }
  }
  return urls.slice(0, 10)
}

/** Run the full 6-step research pipeline */
export async function runResearch(
  topic: string,
  onProgress?: ProgressCallback,
  externalTaskId?: string,
): Promise<{
  taskId: string
  markdown: string
  stats: ResearchStats
  summary: string
}> {
  const taskId = externalTaskId || `research-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const startTime = Date.now()
  const llmConfig = createLLMConfig()

  const task: ResearchTask = tasks.get(taskId) || {
    id: taskId,
    topic,
    status: "running",
    step: "initializing",
    progress: 0,
    startTime,
  }
  tasks.set(taskId, task)

  const report = (step: string, progress: number, detail: string) => {
    task.step = step
    task.progress = progress
    if (process.env.DEEP_RESEARCH_DEBUG === "1") {
      console.error(`[deep-research] ${step} ${progress}% ${detail}`)
    }
    onProgress?.(step, progress, detail)
  }

  if (!llmConfig.apiKey || !llmConfig.baseUrl) {
    task.status = "failed"
    task.error = "Missing Alloy Runtime credentials: ALLOY_RUNTIME_API_URL and ALLOY_RUNTIME_API_KEY"
    throw new Error(task.error)
  }

  const stats = sourceStatsTemplate()

  try {
    // ── Step 1/6: Research Plan ──
    report("Step 1/6", 5, "Generating research plan...")

    const planPrompt = loadPrompt("plan", { TOPIC: topic })
    const planRaw = await callLLM(llmConfig, planPrompt)
    const plan = safeJsonParse<ResearchPlan>(planRaw, null as any)

    if (!plan || !plan.sections || plan.sections.length === 0) {
      throw new Error(`Research plan generation failed. Raw output: ${planRaw.slice(0, 300)}`)
    }

    const elapsed1 = Math.round((Date.now() - startTime) / 1000)
    report("Step 1/6", 15, `Done (${elapsed1}s) | Plan: ${plan.sections.length} sections`)

    // ── Step 2/6: Multi-source Search ──
    report("Step 2/6", 20, "Searching standard source set...")

    const querySet = buildSourceQueries({ query: topic })
    const webKeywords = plan.search_keywords?.web?.length ? plan.search_keywords.web : querySet.web
    const academicKeywords = plan.search_keywords?.academic || []

    const searchPromises: Promise<SearchResult[]>[] = []

    stats.tavily.queries = Math.min(webKeywords.length, 4)
    searchPromises.push(searchTavily(webKeywords))

    stats.brave.queries = Math.min(webKeywords.length, 4)
    searchPromises.push(searchBrave(webKeywords))

    if (plan.data_sources?.academic !== false) {
      stats.arxiv.queries = 1
      searchPromises.push(searchArxiv(academicKeywords))

      stats.pubmed.queries = 1
      searchPromises.push(searchPubmed(academicKeywords))
    }

    if (plan.data_sources?.finance && plan.finance_context) {
      stats.tushare.queries = (plan.finance_context.stock_codes || []).length
      searchPromises.push(searchTushare(plan.finance_context))
    }

    stats.reddit.queries = querySet.reddit.length
    searchPromises.push(searchReddit(querySet.reddit))

    stats.youtube_transcript.queries = querySet.youtube.length
    searchPromises.push(searchYoutube(querySet.youtube, { include_transcripts: true }))

    stats.x.queries = querySet.x.length
    searchPromises.push(searchX(querySet.x))

    const searchResults = await Promise.allSettled(searchPromises)
    let allResults: SearchResult[] = []
    for (const r of searchResults) {
      if (r.status === "fulfilled") allResults = allResults.concat(r.value)
    }

    // Always run direct web extraction against discovered web URLs. This keeps
    // web_extract internal and automatic instead of requiring top-level URLs.
    const urlsToExtract = extractableUrls(allResults)
    stats.web_extract.queries = urlsToExtract.length
    if (urlsToExtract.length > 0) {
      const extracted = await extractWebPages(urlsToExtract)
      allResults = allResults.concat(extracted)
    }

    countSourceStats(stats, allResults)

    let dedupedResults = dedup(allResults)
    if (dedupedResults.length > MAX_SOURCES) {
      dedupedResults = dedupedResults.slice(0, MAX_SOURCES)
    }

    const elapsed2 = Math.round((Date.now() - startTime) / 1000)
    report("Step 2/6", 35, `Done (${elapsed2}s) | ${allResults.length} results → ${dedupedResults.length} after dedup`)

    if (dedupedResults.length === 0) {
      throw new Error("All search sources returned 0 results. Check API keys, credentials, and network.")
    }

    // ── Step 3/6: CRAAP Evaluation ──
    report("Step 3/6", 40, `Evaluating ${dedupedResults.length} sources with CRAAP...`)

    const { evaluated: evaluatedSources, totalBefore } = await evaluateSources(
      dedupedResults,
      topic,
      llmConfig,
    )

    stats.totalSources = evaluatedSources.length
    stats.rejectedSources = totalBefore - evaluatedSources.length
    for (const s of evaluatedSources) {
      stats.tierDistribution[s.tier] = (stats.tierDistribution[s.tier] || 0) + 1
    }

    const elapsed3 = Math.round((Date.now() - startTime) / 1000)
    report("Step 3/6", 55, `Done (${elapsed3}s) | ${stats.totalSources}/${totalBefore} sources passed`)

    // ── Step 4/6: Cross-verification ──
    report("Step 4/6", 60, "Cross-verifying data points...")

    const verification = await verify(evaluatedSources, topic, llmConfig)

    const elapsed4 = Math.round((Date.now() - startTime) / 1000)
    report("Step 4/6", 70, `Done (${elapsed4}s) | ${verification.verified_data_points.length} verified data points`)

    // ── Step 5/6: Writing ──
    report("Step 5/6", 72, "Writing chapters in parallel...")

    const { chapters, summaries } = await writeSections(
      plan,
      evaluatedSources,
      verification,
      topic,
      llmConfig,
    )

    report("Step 5/6", 85, "Writing executive summary...")

    const execSummaryHtml = await writeExecSummary(
      topic,
      plan.core_question,
      summaries,
      verification,
      llmConfig,
    )

    const elapsed5 = Math.round((Date.now() - startTime) / 1000)
    report("Step 5/6", 88, `Done (${elapsed5}s) | ${chapters.length} chapters + summary`)

    // ── Step 6/6: Rendering Markdown ──
    report("Step 6/6", 90, "Rendering Markdown report...")

    const referencesHtml = generateReferencesHtml(evaluatedSources)
    const fullHtml = mergeHtml(topic, {
      execSummary: execSummaryHtml,
      chapters,
      references: referencesHtml,
    })
    const cleanHtml = await sanitizeHtml(fullHtml)
    const markdown = htmlToMarkdown(cleanHtml)

    const elapsed6 = Math.round((Date.now() - startTime) / 1000)
    report("Step 6/6", 100, `Complete (${elapsed6}s)`)

    task.status = "completed"
    task.endTime = Date.now()

    const tierDist = Object.entries(stats.tierDistribution)
      .map(([t, c]) => `T${t}:${c}`)
      .join(" | ")

    const summary = `Deep research report generated inline.\n\nStatistics:\n- Duration: ${elapsed6}s\n- LLM: ${llmConfig.provider} (${llmConfig.model})\n- Search results: ${allResults.length} (${dedupedResults.length} after dedup)\n- CRAAP evaluation: ${stats.totalSources}/${totalBefore} passed (threshold 4.5)\n- Source tiers: ${tierDist}\n- Sections: ${chapters.length} + executive summary + references\n- Verified data points: ${verification.verified_data_points.length}\n- Conflicting data points: ${verification.conflicting_data_points.length}`

    return { taskId, markdown, stats, summary }
  } catch (e: any) {
    task.status = "failed"
    task.error = e.message
    task.endTime = Date.now()
    throw e
  }
}
