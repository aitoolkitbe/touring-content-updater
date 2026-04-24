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
 * Minimale, conservatieve set van selectors om Jina te laten overslaan.
 * We beperken ons tot semantische HTML5-landmarks die op zowat elke site
 * boilerplate bevatten — niet het artikel. Class-name based selectors
 * zijn te gevaarlijk (één site's ".content" is het artikel, een andere
 * site's ".nav" omvat per ongeluk ook de article-header).
 *
 * De écht rommelige content — duplicate images, icon-svgs, thumbnails van
 * gerelateerde content — vangen we na de scrape op (zie parseMarkdown).
 */
const JINA_REMOVE_SELECTORS = [
  // Semantische landmarks: altijd boilerplate, nooit artikel.
  "nav",
  "footer",
  '[role="navigation"]',
  '[role="contentinfo"]',
  // Cookie-/consent-banners — alle grote vendors dekken.
  // Touring gebruikt CookieYes (zichtbaar aan de 'cky-' class-prefix).
  ".cky-consent-container",
  ".cky-modal",
  ".cky-preference-center",
  "#cookieyes",
  '[class*="cky-"]',
  // OneTrust
  '[id^="onetrust"]',
  ".onetrust-banner-sdk",
  // Cookiebot
  "#CybotCookiebotDialog",
  '[id^="CybotCookiebot"]',
  // Cookie Law Info (WP plugin)
  "#cookie-law-info-bar",
  "#cookie-law-info-again",
  // Generieke namen
  ".cookie-banner",
  ".cookie-notice",
  ".cookie-consent",
  ".cookie-popup",
  ".cookies",
  ".gdpr",
  ".gdpr-banner",
  "#cookie-banner",
  "#cookieconsent",
  '[class*="cookie-banner"]',
  '[class*="cookie-notice"]',
  '[class*="cookie-consent"]',
  '[class*="cookieconsent"]',
  '[class*="gdpr-"]',
].join(", ");

/** Maximaal aantal afbeeldingen dat we aan de analyse doorgeven. */
const MAX_IMAGES = 15;

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
  // Stap 1: Jina's eigen "Title: / URL Source: / Markdown Content:"-header weg.
  let cleaned = stripJinaHeader(markdown);
  // Stap 2: structureel: knip alles vóór "skip-to-main-content" en alles
  //         vanaf "## Verwante inhoud" / "## Related" / "## Meer lezen".
  //         Dit pakt het overgrote deel van de boilerplate weg, ook als
  //         de exacte cookie-vendor onbekend is.
  cleaned = extractArticleBody(cleaned);
  // Stap 3: structurele cookie-tabel detecteren en wegknippen
  //         (blok van "* Cookie X / * Looptijd Y / * Beschrijving Z"-bullets).
  cleaned = stripCookieBullets(cleaned);
  // Stap 4: fallback-regex voor losse cookie-banner-zinnen die nog overblijven.
  cleaned = stripCookieBanner(cleaned);
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
  // Cap daarna op MAX_IMAGES: artikelfoto's staan meestal bovenaan; related-thumbs onderaan.
  const seen = new Set<string>();
  const images = rawImages
    .filter((img) => {
      const src = img.src.split("?")[0]; // normaliseer
      if (seen.has(src)) return false;
      seen.add(src);
      return !BOILERPLATE_IMG_PATTERNS.some((re) => re.test(img.src));
    })
    .slice(0, MAX_IMAGES);

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

/**
 * Structurele article-body extractie.
 *
 * Empirisch onderzoek op touring.be: Jina plaatst de cookie-preferences
 * modal + nav HELEMAAL BOVENAAN de markdown, vóór de echte article-body.
 * Het artikel start na de "skip-to-main-content"-link (een accessibility-
 * link die bijna elke site heeft) en eindigt bij een "Verwante inhoud" /
 * "Related" / "Meer lezen" H2.
 *
 * We zoeken dus:
 *   START = na de eerste link die naar #main-content / #content / #main springt
 *   END   = vóór de eerste H1/H2/H3 die "verwante", "gerelateerd", "related"
 *           of "meer lezen" bevat.
 *
 * Valt één van beide anchors niet te vinden, dan vallen we terug op
 * conservatief gedrag (alles overhouden of tot einde).
 */
function extractArticleBody(markdown: string): string {
  let start = 0;
  let end = markdown.length;

  // --- START anchor: skip-to-main-content link geeft ons een POSITIE in
  // de markdown waarna de echte content begint. Maar de navigatie staat
  // vaak NA die skip-link (de skip-link springt naar een HTML-anchor die
  // in de markdown niet zichtbaar is). De robuustste oplossing: na de
  // skip-link zoeken we de eerste H1 of H2 — dat is de article-titel.
  const skipPatterns: RegExp[] = [
    /\[[^\]]*(?:overslaan\s+en\s+naar\s+de\s+inhoud|skip\s+to\s+(?:main\s+)?content|naar\s+de\s+inhoud\s+gaan)[^\]]*\]\([^)]+\)/i,
    /\[[^\]]+\]\([^)]*#(?:main-content|maincontent)[^)]*\)/i,
  ];
  let afterSkipIndex: number | null = null;
  for (const p of skipPatterns) {
    const m = markdown.match(p);
    if (m && m.index !== undefined) {
      afterSkipIndex = m.index + m[0].length;
      break;
    }
  }

  if (afterSkipIndex !== null) {
    // Zoek de eerste H1 (met of zonder voorafgaande whitespace) na de skip-link.
    // Als er geen H1 is, val terug op eerste H2.
    const rest = markdown.slice(afterSkipIndex);
    const h1 = rest.match(/^#\s+.+$/m);
    const h2 = rest.match(/^##\s+.+$/m);
    const firstHeading =
      h1 && (!h2 || (h1.index ?? 0) <= (h2.index ?? Infinity)) ? h1 : h2;
    if (firstHeading && firstHeading.index !== undefined) {
      start = afterSkipIndex + firstHeading.index;
    } else {
      start = afterSkipIndex;
    }
  } else {
    // Geen skip-link gevonden: val terug op eerste H1 in het document.
    const h1 = markdown.match(/^#\s+.+$/m);
    if (h1 && h1.index !== undefined) start = h1.index;
  }

  // --- END anchor: "Verwante inhoud" / "Related" / "Meer lezen" heading ---
  const body = markdown.slice(start);
  const endPatterns: RegExp[] = [
    /^#{1,3}\s+verwante\s+(?:inhoud|artikel(?:s|en)?)\b/im,
    /^#{1,3}\s+gerelateerde?\s+(?:inhoud|artikel(?:s|en)?)\b/im,
    /^#{1,3}\s+meer\s+(?:lezen|artikels?)\b/im,
    /^#{1,3}\s+related\s+(?:content|articles?|posts?)\b/im,
    /^#{1,3}\s+you\s+may\s+(?:also|like)\b/im,
    /^#{1,3}\s+lees\s+(?:ook|meer)\b/im,
  ];
  for (const p of endPatterns) {
    const m = body.match(p);
    if (m && m.index !== undefined) {
      end = start + m.index;
      break;
    }
  }

  return markdown.slice(start, end).trim();
}

/**
 * Detecteert en verwijdert blokken met cookie-declaraties, de structurele
 * tabel die cookie-preferences-modals typisch hebben:
 *
 *   * Cookie <naam>
 *   * Looptijd <tijd> (of: Duration)
 *   * Beschrijving <tekst> (of: Description)
 *
 * Een blok wordt herkend als er minstens 2 opeenvolgende "Cookie X"-bullets
 * zijn — dat gebeurt nooit in een gewoon artikel. We strippen dan tot het
 * blok structureel eindigt.
 */
function stripCookieBullets(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  const isCookieBullet = (line: string): boolean =>
    /^\s*[*-]\s+Cookie\s+\S/i.test(line) ||
    /^\s*[*-]\s+(?:Looptijd|Duration)\s+/i.test(line) ||
    /^\s*[*-]\s+(?:Beschrijving|Description)\s+/i.test(line);
  const isStartOfCookie = (line: string): boolean =>
    /^\s*[*-]\s+Cookie\s+\S/i.test(line);

  let i = 0;
  while (i < lines.length) {
    if (isStartOfCookie(lines[i])) {
      // Kijk vooruit: staan er meerdere "Cookie X"-bullets binnen bereik?
      let cookieCount = 0;
      let j = i;
      while (j < lines.length && j < i + 200) {
        if (isStartOfCookie(lines[j])) cookieCount++;
        // Stop bij een header of lange paragraaf — daar eindigt het blok sowieso.
        if (/^#{1,6}\s+/.test(lines[j])) break;
        j++;
      }
      if (cookieCount >= 2) {
        // Skip het hele blok: alles tot de volgende niet-cookie / niet-lege regel
        // die ook niet met een checkbox-marker of categorienaam start.
        while (
          i < lines.length &&
          (isCookieBullet(lines[i]) ||
            lines[i].trim() === "" ||
            /^\s*-\s+\[[ xX]\]/.test(lines[i]) || // - [x] checkbox marker
            /^\s*(?:Strict\s+noodzakelijk|Functionele\s+cookies|Prestatiecookies|Analytische\s+cookies|Cookies\s+voor\s+|Marketing\s+cookies|Advertising\s+cookies|Always\s+active)/i.test(
              lines[i]
            ))
        ) {
          i++;
        }
        continue;
      }
    }
    out.push(lines[i]);
    i++;
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Verwijdert regels die overduidelijk uit een cookie-/consent-banner komen.
 * We zijn conservatief: alleen regels die vrijwel zeker over een banner gaan
 * worden geschrapt (bv. "Deze website gebruikt cookies", "Info over het
 * [privacybeleid]"). Een artikel dát over cookies zou gaan (zeldzaam voor
 * Touring-content) houdt zijn zinnen omdat die in de context van langere
 * body-paragraven staan — deze regex matcht enkel korte, standalone regels.
 */
function stripCookieBanner(markdown: string): string {
  const patterns: RegExp[] = [
    /^.*deze\s+(?:site|website)\s+gebruikt\s+cookies.*$/gim,
    /^.*we\s+gebruiken\s+cookies.*$/gim,
    /^.*ontdek\s+welke\s+cookies.*$/gim,
    /^.*(?:accepteer|weiger)\s+(?:alle|optionele)?\s*cookies.*$/gim,
    /^.*cookievoorkeuren.*$/gim,
    /^.*cookie[- ]instellingen.*$/gim,
    /^.*cookie[- ]beleid.*$/gim,
    /^.*(?:manage|accept)\s+cookies.*$/gim,
    /^.*this\s+website\s+uses\s+cookies.*$/gim,
    /^.*info\s+over\s+het\s+\[(?:privacybeleid|cookiebeleid)\].*$/gim,
    /^.*\[cookiebeleid\].*$/gim,
    /^.*je\s+kan\s+deze\s+instellingen\s+steeds\s+wijzigen.*$/gim,
  ];
  let out = markdown;
  for (const p of patterns) {
    out = out.replace(p, "");
  }
  // Meerdere lege regels op een rij comprimeren.
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}
