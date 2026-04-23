import { NextRequest, NextResponse } from "next/server";
import { callClaudeTool } from "@/lib/anthropic";
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
// Pro plan: max 300 s. 180 s is ruim voldoende voor Sonnet + Ahrefs + lange artikels.
export const maxDuration = 180;

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
    const article = body.article;
    if (!article?.markdown) {
      return NextResponse.json({ error: "Geen artikel meegegeven." }, { status: 400 });
    }

    // Stap 1: keyword + intent detectie
    const detection = await detectKeyword(article);

    // Stap 2: Ahrefs-data
    const ahrefs = await getAhrefsKeywordData(detection.primaryKeyword);

    // Stap 3: volledige analyse
    const analysis = await runFullAnalysis(article, detection, ahrefs);

    // Ids toekennen aan aanbevelingen
    analysis.recommendations = analysis.recommendations.map((r) => ({
      ...r,
      id: r.id || makeId("rec"),
    }));

    return NextResponse.json({ analysis });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
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

## Volledig artikel (Markdown)
${article.markdown}

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
    maxTokens: 16000,
  });
}
