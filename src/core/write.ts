// Harness Research MCP Server — Chapter Writing & Executive Summary

import type {
  EvaluatedSource,
  LLMConfig,
  ResearchPlan,
  VerificationResult,
} from "../utils/types.js"
import { callLLM } from "./llm.js"
import { loadPrompt } from "../utils/prompts.js"
import { escapeHtml, extractHtml, safeJsonParse } from "../utils/json.js"

/** Match sources to a section by keyword overlap */
function matchSources(
  section: ResearchPlan["sections"][0],
  allSources: EvaluatedSource[],
): EvaluatedSource[] {
  const keywords = [
    section.title.toLowerCase(),
    section.purpose.toLowerCase(),
    ...section.key_data_points.map(p => p.toLowerCase()),
  ]
  return allSources
    .filter(s => {
      const text = `${s.title} ${s.snippet}`.toLowerCase()
      return keywords.some(kw => {
        const words = kw.split(/\s+/).filter(w => w.length > 1)
        return words.some(w => text.includes(w))
      })
    })
    .slice(0, 10)
}

function fallbackSectionHtml(
  section: ResearchPlan["sections"][0],
  sources: EvaluatedSource[],
  reason: string,
): string {
  const bullets = sources.slice(0, 5).map(s => {
    const fact = s.key_facts?.[0] || s.snippet || "Relevant source for this section."
    return `<li><a href="${escapeHtml(s.url)}">${escapeHtml(s.title || s.url)}</a>: ${escapeHtml(fact.slice(0, 280))}</li>`
  }).join("\n")

  return `<h2>${escapeHtml(section.title)}</h2>
<p>${escapeHtml(section.purpose)}</p>
<p><em>LLM prose generation fallback used: ${escapeHtml(reason)}. The evidence below comes from sources that passed source evaluation.</em></p>
<ul>
${bullets || "<li>No matching evaluated sources were available for this section.</li>"}
</ul>`
}

/** Write all sections in parallel */
export async function writeSections(
  plan: ResearchPlan,
  sources: EvaluatedSource[],
  verification: VerificationResult,
  topic: string,
  llmConfig: LLMConfig,
): Promise<{ chapters: string[]; summaries: string[] }> {
  const verificationText = JSON.stringify(verification, null, 2)

  const sectionPromises = plan.sections.map(async (section) => {
    const matched = matchSources(section, sources)
    const sectionSources = matched.length > 0 ? matched : sources.slice(0, 5)
    const materialsText = sectionSources
      .map(
        s =>
          `[T${s.tier}] ${s.title}\nURL: ${s.url}\nSnippet: ${s.snippet.slice(0, 400)}\nKey facts: ${s.key_facts.join("; ")}`,
      )
      .join("\n\n")

    const prompt = loadPrompt("write_section", {
      TOPIC: topic,
      CORE_QUESTION: plan.core_question,
      SECTION_TITLE: section.title,
      SECTION_PURPOSE: section.purpose,
      KEY_DATA_POINTS: section.key_data_points.join(", "),
      SOURCE_MATERIALS: materialsText || "(No matching sources, write based on verified data)",
      VERIFICATION: verificationText,
    })

    try {
      const raw = await callLLM(llmConfig, prompt, 0.4, 3500)
      const parsed = safeJsonParse<{ analysis: any; html: string }>(raw, null as any)
      if (parsed && parsed.html) {
        return {
          html: parsed.html,
          analysis: parsed.analysis || { core_argument: section.title, supporting_points: [] },
        }
      }
      const htmlMatch = raw.match(/<h2[\s\S]*$/i)
      if (htmlMatch) {
        return {
          html: htmlMatch[0],
          analysis: { core_argument: section.title, supporting_points: [] },
        }
      }
      return {
        html: fallbackSectionHtml(section, sectionSources, "model response did not contain parseable HTML"),
        analysis: { core_argument: section.title, supporting_points: [] },
      }
    } catch (e: any) {
      return {
        html: fallbackSectionHtml(section, sectionSources, e.message || "unknown error"),
        analysis: { core_argument: section.title, supporting_points: [] },
      }
    }
  })

  const results = await Promise.allSettled(sectionPromises)
  const chapters: string[] = []
  const summaries: string[] = []

  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    if (r.status === "fulfilled" && r.value) {
      chapters.push(r.value.html)
      summaries.push(
        `Chapter ${i + 1} "${plan.sections[i].title}" core argument: ${r.value.analysis?.core_argument || "N/A"}`,
      )
    } else {
      chapters.push(
        `<h2>${escapeHtml(plan.sections[i].title)}</h2><p>Chapter generation failed.</p>`,
      )
      summaries.push(`Chapter ${i + 1} "${plan.sections[i].title}": generation failed`)
    }
  }

  return { chapters, summaries }
}

/** Write executive summary */
export async function writeExecSummary(
  topic: string,
  coreQuestion: string,
  sectionSummaries: string[],
  verification: VerificationResult,
  llmConfig: LLMConfig,
): Promise<string> {
  const counterintuitiveText =
    verification.counterintuitive_findings.length > 0
      ? verification.counterintuitive_findings.map(f => `- ${f.finding}`).join("\n")
      : "No counterintuitive findings"

  const summaryPrompt = loadPrompt("exec_summary", {
    TOPIC: topic,
    CORE_QUESTION: coreQuestion,
    SECTION_SUMMARIES: sectionSummaries.join("\n"),
    COUNTERINTUITIVE_FINDINGS: counterintuitiveText,
  })

  try {
    const summaryRaw = await callLLM(llmConfig, summaryPrompt, 0.3, 2000)
    return extractHtml(summaryRaw)
  } catch {
    return `<h2>Executive Summary</h2><p>Summary generation failed.</p>`
  }
}
