import { NextRequest, NextResponse } from "next/server";
import { callClaudeTool, getModel } from "@/lib/anthropic";
import { getAhrefsKeywordData } from "@/lib/ahrefs";
import { TOURING_TOV, TOURING_INTERNAL_LINKS } from "@/lib/knowledge/touring-tov";
import { SEO_EXPERTISE } from "@/lib/knowledge/seo-expertise";
import {
  ANALYSIS_SCHEMA,
  KEYWORD_DETECTION_SCHEMA,
} from "@/lib/schemas";
import type { AnalysisResult } from "@/lib/types";
import { makeId } from "@/lib/utils";
import type { ScrapedArticle } from "@/lib/jina";

export const runtime = "nodejs";
// Pro plan: max 300 s. 270 s geeft headroom voor Sonnet op zeer lange artikels.
// Voor nóg snellere runs: zet ANTHROPIC_MODEL=claude-haiku-4-5-20251001 in Vercel env vars.
export const maxDuration = 270;

/** Limiteer de artikel-input om Sonnet niet te laten verdrinken in 30k+ tokens. */
const MAX_ARTICLE_CHARS = 20000;

/**
 * POST /api/analyze
 * Body: { article: ScrapedArticle }
 * Return: AnalysisResult
 *
 * Flow:
 *  1. Claude detecteert het primaire keyword + zoekintentie uit de tekst.
 *  2. We halen Ahrefs-data op voor dat keyword (als API-key aanwezig).
 *  3. Claude doet een grondige SEO/GEO-analyse met die context en levert
 *     een lijst van concrete, aanvinkbare aanbevelingen.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { article: ScrapedArticle };
    const article = normalizeArticle(body.article);
    if (!article?.markdown) {
      return NextResponse.json({ error: "Geen artikel meegegeven." }, { status: 400 });
    }

    // Stap 1: keyword + intent detectie
    const detection = normalizeDetection(await detectKeyword(article));

    // Stap 2: Ahrefs-data
    const ahrefs = await getAhrefsKeywordData(detection.primaryKeyword);

    // Stap 3: volledige analyse
    const rawAnalysis = await runFullAnalysis(article, detection, ahrefs);
    const analysis = normalizeAnalysis(rawAnalysis, article, detection);

    if (analysis.recommendations.length === 0) {
      return NextResponse.json(
        {
          error:
            "Het model gaf geen aanbevelingen terug. Probeer opnieuw, of zet ANTHROPIC_MODEL_ANALYZE=claude-sonnet-4-6 in Vercel voor betrouwbaardere structured output.",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ analysis });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Zorgt dat elk array-veld gegarandeerd een array is (Jina kan ze missen). */
function normalizeArticle(a: ScrapedArticle | undefined): ScrapedArticle | null {
  if (!a || typeof a !== "object" || !a.markdown) return null;
  return {
    url: a.url ?? "unknown",
    title: a.title ?? null,
    markdown: a.markdown,
    wordCount: typeof a.wordCount === "number" ? a.wordCount : 0,
    images: Array.isArray(a.images) ? a.images : [],
    headings: Array.isArray(a.headings) ? a.headings : [],
    links: Array.isArray(a.links) ? a.links : [],
    hasDateStamp: Boolean(a.hasDateStamp),
  };
}

function normalizeDetection(d: Partial<Detection> | undefined): Detection {
  return {
    primaryKeyword:
      typeof d?.primaryKeyword === "string" && d.primaryKeyword.trim()
        ? d.primaryKeyword.trim()
        : "touring content",
    secondaryKeywords: Array.isArray(d?.secondaryKeywords)
      ? d!.secondaryKeywords.filter(
          (s): s is string => typeof s === "string" && s.length > 0
        )
      : [],
    intent:
      d?.intent === "commercial" ||
      d?.intent === "transactional" ||
      d?.intent === "navigational"
        ? d.intent
        : "informational",
  };
}

function normalizeAnalysis(
  a: Partial<AnalysisResult> | undefined,
  article: ScrapedArticle,
  detection: Detection
): AnalysisResult {
  const recs = Array.isArray(a?.recommendations) ? a!.recommendations : [];
  const h1 = article.headings.filter((h) => h.level === 1).length;
  const h2 = article.headings.filter((h) => h.level === 2).length;
  const h3 = article.headings.filter((h) => h.level === 3).length;

  return {
    summary: typeof a?.summary === "string" ? a.summary : "",
    seo: {
      primaryKeyword: a?.seo?.primaryKeyword ?? detection.primaryKeyword,
      secondaryKeywords: Array.isArray(a?.seo?.secondaryKeywords)
        ? a!.seo!.secondaryKeywords
        : detection.secondaryKeywords,
      intent: a?.seo?.intent ?? detection.intent,
    },
    articleMeta: {
      detectedTitle: a?.articleMeta?.detectedTitle ?? article.title ?? null,
      wordCount: a?.articleMeta?.wordCount ?? article.wordCount,
      headingCount: a?.articleMeta?.headingCount ?? { h1, h2, h3 },
      hasDateStamp: a?.articleMeta?.hasDateStamp ?? article.hasDateStamp,
      imageCount: a?.articleMeta?.imageCount ?? article.images.length,
    },
    recommendations: recs
      .filter((r): r is NonNullable<typeof r> => r != null && typeof r === "object")
      .map((r) => ({
        id: typeof r.id === "string" && r.id ? r.id : makeId("rec"),
        category: (r.category ?? "technical_hygiene") as AnalysisResult["recommendations"][number]["category"],
        title: typeof r.title === "string" ? r.title : "(geen titel)",
        description: typeof r.description === "string" ? r.description : "",
        suggestion: typeof r.suggestion === "string" ? r.suggestion : undefined,
        impact:
          r.impact === "high" || r.impact === "low" ? r.impact : "medium",
        location: typeof r.location === "string" ? r.location : undefined,
      })),
  };
}

interface Detection {
  primaryKeyword: string;
  secondaryKeywords: string[];
  intent: "informational" | "commercial" | "transactional" | "navigational";
}

async function detectKeyword(article: ScrapedArticle): Promise<Detection> {
  const system =
    "Je bent een SEO-strateeg. Je leidt het primaire keyword en de zoekintentie van een bestaand Touring-blogartikel af, en geeft 3-6 secundaire keywords.";

  const user = `TITEL: ${article.title ?? "(geen)"}
KOPPEN: ${article.headings.map((h) => `H${h.level}: ${h.text}`).join(" | ")}

ARTIKEL (eerste 2000 tekens):
${article.markdown.slice(0, 2000)}`;

  return callClaudeTool<Detection>({
    system,
    user,
    toolName: "detect_keyword",
    toolDescription:
      "Lever het gedetecteerde primaire keyword, secundaire keywords en zoekintentie.",
    inputSchema: KEYWORD_DETECTION_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 800,
    model: getModel("analyze"),
  });
}

async function runFullAnalysis(
  article: ScrapedArticle,
  detection: Detection,
  ahrefs: Awaited<ReturnType<typeof getAhrefsKeywordData>>
): Promise<AnalysisResult> {
  const system = `Je bent een senior SEO-, GEO- en content-strateeg voor Touring.be.
Je adviseert een copywriter die een bestaand blogartikel gaat updaten. Je doel is
een grondige, eerlijke analyse met concrete, uitvoerbare aanbevelingen. Vaagheid
is verboden. Elke aanbeveling moet de copywriter exact vertellen wát te wijzigen
en wáárom dat de ranking, de AI-citatie of de lezer helpt.

## REFERENTIE 1 — TOURING TONE OF VOICE
${TOURING_TOV}

## REFERENTIE 2 — TOP INTERNE LINKS
${TOURING_INTERNAL_LINKS}

## REFERENTIE 3 — SEO/GEO EXPERTISE
${SEO_EXPERTISE}`;

  const ahrefsBlock = ahrefs
    ? `# Ahrefs-data (Belgische markt)
- Hoofdkeyword: "${detection.primaryKeyword}"
- Maandelijks volume: ${ahrefs.volume ?? "onbekend"}
- Keyword Difficulty: ${ahrefs.difficulty ?? "onbekend"}
- CPC: ${ahrefs.cpc ?? "onbekend"}
- Gerelateerde termen (Ahrefs):
${ahrefs.relatedTerms.map((r) => `  - ${r.keyword} (volume ${r.volume ?? "?"})`).join("\n")}
${ahrefs.warnings?.length ? `\nWarnings: ${ahrefs.warnings.join("; ")}` : ""}`
    : `# Ahrefs-data
Niet beschikbaar (geen API-token of call faalde). Werk met het gedetecteerde hoofdkeyword en je eigen expertise.`;

  const user = `# BESTAAND ARTIKEL

## Gedetecteerde metadata
- Titel: ${article.title ?? "(geen)"}
- Woordenaantal: ${article.wordCount}
- H1/H2/H3-koppen: ${article.headings.length}
- Afbeeldingen: ${article.images.length}
- Outbound/internal links: ${article.links.length}
- Tekst bevat jaartal/datum: ${article.hasDateStamp}

## Gedetecteerd keyword & intent
- Primair: ${detection.primaryKeyword}
- Secundair: ${detection.secondaryKeywords.join(", ")}
- Intent: ${detection.intent}

${ahrefsBlock}

## Huidige koppen
${article.headings.map((h) => `H${h.level}: ${h.text}`).join("\n") || "(geen)"}

## Huidige afbeeldingen (src — alt)
${article.images
  .slice(0, 20)
  .map((i) => `- ${i.src.slice(0, 80)} — alt: "${i.alt ?? ""}"`)
  .join("\n") || "(geen)"}

## Volledig artikel (Markdown${
    article.markdown.length > MAX_ARTICLE_CHARS ? ", afgekapt tot ~20.000 tekens" : ""
  })
${article.markdown.slice(0, MAX_ARTICLE_CHARS)}

---

# OPDRACHT

Geef een analyse voor een content-update van dit artikel. Roep de tool \`submit_analysis\` aan met je bevindingen.

## Regels voor je aanbevelingen
1. Minimum 12 aanbevelingen, maximum 25. Geen opvulling, elke aanbeveling moet de copywriter echt vooruit helpen.
2. Spreid over de 11 categorieën — elke relevante categorie minstens één aanbeveling waar van toepassing.
3. Elke aanbeveling bevat een "suggestion" met een concreet voorbeeld, tenzij onmogelijk.
4. Voor images: benoem per afbeelding met zwakke bestandsnaam of alt-tekst een specifieke verbetering.
5. Voor GEO: geef concrete Q&A-blokken of FAQ-vragen die toegevoegd zouden moeten worden.
6. Voor freshness: markeer verouderde statistieken, ontbrekende datums, en plekken waar "recent/binnenkort" staat zonder datum.
7. Voor E-E-A-T: vermeld wat er mist (auteursblock, bronverwijzing, first-hand ervaring, sameAs).
8. Voor internal linking: stel concrete interne Touring-links voor uit de meegegeven lijst.
9. Impact: "high" voor aanbevelingen die waarschijnlijk een zichtbare ranking- of CTR-verbetering opleveren; "medium" voor duidelijke verbeteringen; "low" voor fijn-slijpen.
10. Titels zijn actiegericht ("Herformuleer H2 over kosten tot een PAA-vraag") — geen beschrijvingen ("H2 over kosten").`;

  return callClaudeTool<AnalysisResult>({
    system,
    user,
    toolName: "submit_analysis",
    toolDescription:
      "Lever de volledige SEO-/GEO-analyse van het artikel met 12-25 concrete, aanvinkbare aanbevelingen.",
    inputSchema: ANALYSIS_SCHEMA as unknown as Record<string, unknown>,
    // 8000 is ruim genoeg voor 12-25 aanbevelingen (~300 tokens elk + summary).
    // Hogere waarden doen het model onnodig traag werken.
    maxTokens: 8000,
    model: getModel("analyze"),
  });
}
