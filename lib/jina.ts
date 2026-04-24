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

/**
 * Selectors van elementen die Jina voor de extractie moet wegknippen.
 * Dit houdt de gescrapete markdown beperkt tot het eigenlijke artikel en
 * weert nav, footer, sidebars en related-lijsten uit.
 */
const JINA_REMOVE_SELECTORS = [
  "header",
  "nav",
  "footer",
  "aside",
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  ".header",
  ".site-header",
  ".main-header",
  ".footer",
  ".site-footer",
  ".main-footer",
  ".nav",
  ".navigation",
  ".main-nav",
  ".menu",
  ".sidebar",
  ".related",
  ".related-articles",
  ".related-content",
  ".more-articles",
  ".recommended",
  ".social-share",
  ".share",
  ".breadcrumb",
  ".cookie",
  ".newsletter",
  ".popup",
  ".modal",
  "[class*='related']",
  "[class*='sidebar']",
  "[class*='footer']",
  "[class*='nav-']",
  "[class*='newsletter']",
].join(", ");

/**
 * Patronen die in een image-URL sterk op boilerplate (icoon, logo, UI-sprite) wijzen.
 * Afbeeldingen die hieraan voldoen worden uit de analyse gehaald.
 */
const BOILERPLATE_IMG_PATTERNS = [
  /\/icons?\//i,
  /\/logo/i,
  /\/sprite/i,
  /\/symbol/i,
  /\/emoji/i,
  /\/flag/i,
  /\/avatar/i,
  /\/favicon/i,
  /\/badge/i,
  /\/social/i,
  /[?&](icon|logo|sprite)=/i,
  /\.svg(\?|$)/i, // artikelfoto's zijn bijna nooit svg; icons bijna altijd wel
];

export async function scrapeWithJina(url: string): Promise<ScrapedArticle> {
  if (!/^https?:\/\//.test(url)) {
    throw new Error("Ongeldige URL — moet beginnen met http(s)://");
  }

  const jinaUrl = `https://r.jina.ai/${url}`;
  const headers: Record<string, string> = {
    Accept: "text/plain",
    "X-Return-Format": "markdown",
    "X-Remove-Selector": JINA_REMOVE_SELECTORS,
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
  // Jina plakt een "Title: ..." en soms "URL Source: ..." / "Markdown Content:"
  // bovenaan. We knippen die weg zodat het echte artikel overblijft.
  const cleaned = stripJinaHeader(markdown);
  const lines = cleaned.split("\n");

  // Title: eerste H1 of de "Title:" regel die Jina vaak bovenaan zet.
  let title: string | null = null;
  const titleMatch =
    markdown.match(/^Title:\s*(.+)$/m) || cleaned.match(/^#\s+(.+)$/m);
  if (titleMatch) title = titleMatch[1].trim();

  // Images: ![alt](src)
  const rawImages: Array<{ src: string; alt: string | null }> = [];
  const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = imgRegex.exec(cleaned)) !== null) {
    rawImages.push({ alt: m[1] || null, src: m[2] });
  }
  // Filter boilerplate images op URL-patroon en dedupe identieke src.
  const seen = new Set<string>();
  const images = rawImages.filter((img) => {
    const src = img.src.split("?")[0]; // normaliseer
    if (seen.has(src)) return false;
    seen.add(src);
    return !BOILERPLATE_IMG_PATTERNS.some((re) => re.test(img.src));
  });

  // Headings: # / ## / ### aan regelbegin
  const headings: Array<{ level: 1 | 2 | 3; text: string }> = [];
  for (const line of lines) {
    const h = line.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      const level = h[1].length as 1 | 2 | 3;
      headings.push({ level, text: h[2].trim() });
    }
  }

  // Links: [text](href) — exclusief images
  const links: Array<{ href: string; text: string }> = [];
  const linkRegex = /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g;
  while ((m = linkRegex.exec(cleaned)) !== null) {
    links.push({ text: m[1], href: m[2] });
  }

  // Woord count (ruw)
  const stripped = cleaned
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[[^\]]+\]\([^)]+\)/g, "$1")
    .replace(/[#*_`>~-]/g, " ");
  const wordCount = stripped.trim().split(/\s+/).filter(Boolean).length;

  // Date: YYYY, "januari 2024", "Published on", "Laatste update" etc.
  const hasDateStamp =
    /\b(20\d{2})\b/.test(cleaned) ||
    /Laatst.{0,5}update|Gepubliceerd|Published on|Bijgewerkt/i.test(cleaned);

  return {
    url,
    title,
    markdown: cleaned,
    wordCount,
    images,
    headings,
    links,
    hasDateStamp,
  };
}

/**
 * Verwijdert de "Title: / URL Source: / Published Time: / Markdown Content:"
 * header die Jina standaard vooraan zet. Die is handig als metadata, maar
 * vervuilt de analyse als hij in het "artikel" wordt meegenomen.
 */
function stripJinaHeader(markdown: string): string {
  const marker = markdown.indexOf("Markdown Content:");
  if (marker !== -1) {
    return markdown.slice(marker + "Markdown Content:".length).trimStart();
  }
  // Fallback: knip de eerste blokjes "Key: value"-regels.
  const lines = markdown.split("\n");
  let i = 0;
  while (
    i < lines.length &&
    /^(Title|URL Source|Published Time|Warning|Markdown Content):/i.test(
      lines[i]
    )
  ) {
    i++;
  }
  // Sla eventuele lege regels na de header over
  while (i < lines.length && lines[i].trim() === "") i++;
  return lines.slice(i).join("\n");
}
