export interface SourceQueryInput {
  query: string
  web_queries?: string[]
  reddit_queries?: string[]
  youtube_queries?: string[]
  x_queries?: string[]
  urls?: string[]
}

export interface SourceQuerySet {
  web: string[]
  reddit: string[]
  youtube: string[]
  x: string[]
  urls: string[]
}

function cleanQueries(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return values
    .filter((v): v is string => typeof v === "string")
    .map(v => v.trim())
    .filter(Boolean)
}

export function buildSourceQueries(input: SourceQueryInput): SourceQuerySet {
  const fallback = input.query.trim()
  const web = cleanQueries(input.web_queries)
  const reddit = cleanQueries(input.reddit_queries)
  const youtube = cleanQueries(input.youtube_queries)
  const x = cleanQueries(input.x_queries)
  const urls = cleanQueries(input.urls)

  return {
    web: web.length ? web : [fallback],
    reddit: reddit.length ? reddit : [`${fallback} reddit discussion`],
    youtube: youtube.length ? youtube : [`${fallback} tutorial demo`],
    x: x.length ? x : [fallback],
    urls,
  }
}
