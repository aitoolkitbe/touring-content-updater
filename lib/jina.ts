/**
 * Jina AI Reader client voor het ophalen van de inhoud van een URL
 * als schone markdown. Gratis, geen API-key nodig voor lage volumes.
 *
 * Docs: https://jina.ai/reader/
 * Endpoint: https://r.jina.ai/<URL>
 */

export interface ScrapedArticle {
  url: string;
  title: string | null;
  /** Volledig artikel in Markdown. */
  markdown: string;
  /** Ruwe woordenlijst voor analyse. */
  wordCount: number;
  /** Gedetecteerde afbeeldingen met src + alt. */
  images: Array<{ src: string; alt: string | null }>;
  /** Gedetecteerde H1/H2/H3 koppen in volgorde. */
  headings: Array<{ level: 1 | 2 | 3; text: string }>;
  /** Gedetecteerde outgoing links. */
  links: Array<{ href: string; text: string }>;
  /** Aanwezigheid van datum in de markdown (grove check). */
  hasDateStamp: boolean;
}

export async function scrapeWithJina(url: string): Promise<ScrapedArticle> {
  if (!/^https?:\/\//.test(url)) {
    throw new Error("Ongeldige URL — moet beginnen met http(s)://");
  }

  const jinaUrl = `https://r.jina.ai/${url}`;
  const headers: Record<string, string> = {
    Accept: "text/plain",
    "X-Return-Format": "markdown",
  };
  // Optionele API-key voor hogere rate-limits; werkt ook zonder.
  if (process.env.JINA_API_KEY) {
    headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`;
  }

  const res = await fetch(jinaUrl, { headers, cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Jina Reader gaf status ${res.status}. URL bereikbaar? Body: ${body.slice(0, 300)}`
    );
  }
  const markdown = await res.text();

  return parseMarkdown(url, markdown);
}

/**
 * Voor gebruikers die de tekst plakken in plaats van een URL.
 */
export function parsePastedMarkdown(markdown: string): ScrapedArticle {
  return parseMarkdown("pasted://content", markdown);
}

function parseMarkdown(url: string, markdown: string): ScrapedArticle {
  const lines = markdown.split("\n");

  // Title: eerste H1 of de "Title:" regel die Jina vaak bovenaan zet.
  let title: string | null = null;
  const titleMatch =
    markdown.match(/^Title:\s*(.+)$/m) ||
    markdown.match(/^#\s+(.+)$/m);
  if (titleMatch) title = titleMatch[1].trim();

  // Images: ![alt](src)
  const images: Array<{ src: string; alt: string | null }> = [];
  const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = imgRegex.exec(markdown)) !== null) {
    images.push({ alt: m[1] || null, src: m[2] });
  }

  // Headings: #/## /### at line start
  const headings: Array<{ level: 1 | 2 | 3; text: string }> = [];
  for (const line of lines) {
    const h = line.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      const level = h[1].length as 1 | 2 | 3;
      headings.push({ level, text: h[2].trim() });
    }
  }

  // Links: [text](href) — maar exclude images
  const links: Array<{ href: string; text: string }> = [];
  const linkRegex = /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g;
  while ((m = linkRegex.exec(markdown)) !== null) {
    links.push({ text: m[1], href: m[2] });
  }

  // Woord count (ruw)
  const stripped = markdown
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[[^\]]+\]\([^)]+\)/g, "$1")
    .replace(/[#*_`>~-]/g, " ");
  const wordCount = stripped.trim().split(/\s+/).filter(Boolean).length;

  // Date: YYYY, "januari 2024", "Published on", "Laatste update" etc.
  const hasDateStamp =
    /\b(20\d{2})\b/.test(markdown) ||
    /Laatst.{0,5}update|Gepubliceerd|Published on|Bijgewerkt/i.test(markdown);

  return {
    url,
    title,
    markdown,
    wordCount,
    images,
    headings,
    links,
    hasDateStamp,
  };
}
