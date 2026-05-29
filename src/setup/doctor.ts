// Harness Research MCP Server — Doctor (Environment Diagnostics)

import fs from "node:fs"
import { CONFIG_DIR, ENV_PATH, loadEnv, getKeyStatus, RESOURCE_DIR, PROMPTS_DIR } from "../utils/config.js"

export async function runDoctor(): Promise<void> {
  loadEnv()

  console.log("")
  console.log("╔══════════════════════════════════════════════════╗")
  console.log("║       Harness Research MCP — Doctor              ║")
  console.log("╚══════════════════════════════════════════════════╝")
  console.log("")

  let issues = 0

  const nodeVersion = process.version
  const major = parseInt(nodeVersion.slice(1))
  console.log(`  Node.js: ${nodeVersion} ${major >= 18 ? "✅" : "❌ (need >= 18)"}`)
  if (major < 18) issues++

  console.log(`  Config dir: ${CONFIG_DIR} ${fs.existsSync(CONFIG_DIR) ? "✅" : "⬜ optional"}`)
  console.log(`  .env file: ${ENV_PATH} ${fs.existsSync(ENV_PATH) ? "✅" : "⬜ optional; Hermes env fallback is supported"}`)

  console.log("")
  console.log("  API Keys:")
  const keys = getKeyStatus()

  const hasLLM = keys.ALLOY_RUNTIME_API_URL && keys.ALLOY_RUNTIME_API_KEY

  console.log(`    ALLOY_RUNTIME_API_URL: ${keys.ALLOY_RUNTIME_API_URL ? "✅ set" : "❌ missing"} (required)`)
  console.log(`    ALLOY_RUNTIME_API_KEY: ${keys.ALLOY_RUNTIME_API_KEY ? "✅ set" : "❌ missing"} (required)`)
  console.log(`    TAVILY_API_KEY:        ${keys.TAVILY_API_KEY ? "✅ set" : "⬜ optional"}`)
  console.log(`    BRAVE_API_KEY:         ${keys.BRAVE_API_KEY ? "✅ set" : "⬜ optional"}`)
  console.log(`    XAI_API_KEY:           ${keys.XAI_API_KEY ? "✅ set" : "⬜ optional; Hermes xAI OAuth fallback is supported"}`)
  console.log(`    YOUTUBE_API_KEY:       ${keys.YOUTUBE_API_KEY ? "✅ set" : "⬜ optional (YouTube search)"}`)
  console.log(`    TUSHARE_TOKEN:         ${keys.TUSHARE_TOKEN ? "✅ set" : "⬜ optional"}`)
  console.log(`    NCBI_API_KEY:          ${keys.NCBI_API_KEY ? "✅ set" : "⬜ optional"}`)

  if (!(keys.TAVILY_API_KEY || keys.BRAVE_API_KEY)) {
    console.log("    ⚠ Optional: add TAVILY_API_KEY or BRAVE_API_KEY for stronger general web search")
  }
  if (!hasLLM) {
    console.log("    ❌ Need ALLOY_RUNTIME_API_URL and ALLOY_RUNTIME_API_KEY for Kimi K2.6 through Alloy Runtime / Fireworks")
    issues++
  }

  console.log("")
  console.log("  Resources:")
  const promptFiles = ["plan.md", "craap_eval.md", "verify.md", "write_section.md", "exec_summary.md"]
  for (const f of promptFiles) {
    const p = `${PROMPTS_DIR}/${f}`
    const exists = fs.existsSync(p)
    console.log(`    prompts/${f}: ${exists ? "✅" : "❌"}`)
    if (!exists) issues++
  }

  const tiersPath = `${RESOURCE_DIR}/source_tiers.yaml`
  console.log(`    source_tiers.yaml: ${fs.existsSync(tiersPath) ? "✅" : "❌"}`)
  if (!fs.existsSync(tiersPath)) issues++

  const cssPath = `${RESOURCE_DIR}/styles.css`
  console.log(`    styles.css: ${fs.existsSync(cssPath) ? "✅" : "❌"}`)
  if (!fs.existsSync(cssPath)) issues++

  console.log("")
  console.log("  Rendering:")
  console.log("    Markdown inline: ✅")

  console.log("")
  if (issues === 0) {
    console.log("  ✅ All checks passed! Harness Research is ready.")
  } else {
    console.log(`  ⚠ ${issues} issue(s) found. Run setup or add credentials to Hermes env.`)
  }
  console.log("")
}
