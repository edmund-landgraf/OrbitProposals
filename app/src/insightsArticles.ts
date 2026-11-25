// Registry of published Insights articles, shown on /insights (newest first).
// Dates come from each article's own published date; reading time is computed
// from the article's markdown word count, so neither is hand-entered.
import whoPaysSource from "./articles/who-pays-for-the-ai.md?raw";

export const READING_WPM = 230;

/** Strip front matter, the H1, and markdown syntax, then count words. */
export function countMarkdownWords(source: string): number {
  const text = source
    .replace(/\r\n/g, "\n")
    .replace(/^---\n[\s\S]*?\n---\n+/, "")
    .replace(/^# [^\n]*\n+/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, " ")
    .replace(/[#>*_`|~-]+/g, " ");
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

export function readingMinutes(source: string): number {
  return Math.max(1, Math.ceil(countMarkdownWords(source) / READING_WPM));
}

export type InsightsArticle = {
  /** Page key of the article route in App.tsx. */
  page: "article-who-pays";
  /** Short title, shown in the list row. */
  title: string;
  /** Full title: the article route's h1, document title, and routes.json entry. */
  fullTitle: string;
  summary: string;
  /** ISO date (YYYY-MM-DD) the article was published. */
  published: string;
  readingMinutes: number;
  /** Markdown source, rendered verbatim by ArticleBody. */
  source: string;
};

const articles: InsightsArticle[] = [
  {
    page: "article-who-pays",
    title: "Who Pays for the AI? Four Ways to Add AI to Your Business",
    fullTitle: "Who Pays for the AI? Four Ways to Add AI to Your Business, and What Each One Costs.",
    summary: "API keys, your own model, vendor bundles, or bring-your-own-client MCP: who pays each time someone uses the AI, and what each approach costs.",
    // Matches the article's front matter and its <time dateTime="2026-10-21"> byline.
    published: "2026-10-21",
    readingMinutes: readingMinutes(whoPaysSource),
    source: whoPaysSource,
  },
];

/** Published articles, newest first. */
export const insightsArticles: InsightsArticle[] = [...articles].sort((a, b) => b.published.localeCompare(a.published));

export function findInsightsArticle(page: string): InsightsArticle | undefined {
  return insightsArticles.find((article) => article.page === page);
}

/** "2026-10-21" -> "October 21, 2026" (and "Oct 21, 2026" when short), without timezone drift. */
export function formatArticleDate(iso: string, style: "long" | "short" = "long"): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: style, day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}
