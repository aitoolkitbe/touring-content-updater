import { NextRequest, NextResponse } from "next/server";
import { callClaudeJson } from "@/lib/anthropic";
import { TOURING_TOV, TOURING_INTERNAL_LINKS } from "@/lib/knowledge/touring-tov";
import { SEO_EXPERTISE } from "@/lib/knowledge/seo-expertise";
import type { Recommendation, RewriteResult } from "@/lib/types";
import type { ScrapedArticle } from "@/lib/jina";

export const runtime = "nodejs";
// Pro plan: max 300 s. Herschrijven van een langer artikel kan 2 min duren.
export const maxDuration = 240;

/**
 * POST /api/rewrite
 * Body: {
 *   article: ScrapedArticle,
 *   selected: Recommendation[],   // alleen aangevinkte aanbevelingen
 *   primaryKeyword: string,
 *   secondaryKeywords: string[]
 * }
 * Return: RewriteResult
 *
 * De herschrijving blijft qua inhoud en toon dicht bij het origineel; enkel de
 * aangevinkte verbeteringen worden doorgevoerd. Geen vrije creatieve herinterpretatie.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      article: ScrapedArticle;
      selected: Recommendation[];
      primaryKeyword: string;
      secondaryKeywords: string[];
    };

    if (!body.article?.markdown) {
      return NextResponse.json({ error: "Geen artikel meegegeven." }, { status: 400 });
    }
    if (!body.selected || body.selected.length === 0) {
      return NextResponse.json(
        { error: "Geen aanbevelingen geselecteerd." },
        { status: 400 }
      );
    }

    const result = await rewrite(body);
    return NextResponse.json({ result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function rewrite(params: {
  article: ScrapedArticle;
  selected: Recommendation[];
  primaryKeyword: string;
  secondaryKeywords: string[];
}): Promise<RewriteResult> {
  const { article, selected, primaryKeyword, secondaryKeywords } = params;

  const system = `Je bent een ervaren Touring-copywriter. Je hebt net een content-brief
ontvangen en je taak is het bestaande artikel te herschrijven volgens precies die
aanbevelingen — niet meer, niet minder.

## REGELS
1. Blijf inhoudelijk DICHT bij het origineel. Geen nieuwe standpunten, geen nieuwe feiten
   die niet al in het artikel staan of die de aanbevelingen expliciet vragen.
2. Voer ALLEEN de aangevinkte aanbevelingen door. Laat de rest ongemoeid.
3. Volg de Touring tone of voice strikt — zie referentie hieronder.
4. Lever het hele artikel als schone Markdown. Inclusief nieuwe title-voorstel,
   meta description, H1, body, nieuwe alt-teksten voor afbeeldingen waar relevant.
5. Geen AI-slop. Geen buzzwords. Geen emoji's. Geen holle openers.
6. Primair keyword: "${primaryKeyword}". Verwerk natuurlijk, 0,5-1,5% densiteit.
7. Secundaire keywords om te verweven: ${secondaryKeywords.join(", ") || "(geen)"}.
8. Interne links: 3-5, uit de meegegeven lijst, alleen als echt relevant.

Lever pure JSON volgens dit schema:
{
  "rewritten": "VOLLEDIG HERSCHREVEN ARTIKEL IN MARKDOWN",
  "changelog": [
    { "recommendationId": "string", "where": "korte locatie", "what": "wat je concreet gewijzigd hebt" }
  ]
}

## REFERENTIE 1 — TOURING TONE OF VOICE
${TOURING_TOV}

## REFERENTIE 2 — TOP INTERNE LINKS
${TOURING_INTERNAL_LINKS}

## REFERENTIE 3 — SEO/GEO EXPERTISE
${SEO_EXPERTISE}`;

  const user = `# HERSCHRIJFOPDRACHT

## Aangevinkte aanbevelingen (ALLEEN deze doorvoeren)
${selected
  .map(
    (r, i) => `
### ${i + 1}. [${r.category} / impact: ${r.impact}] ${r.title}
- Locatie: ${r.location ?? "n.v.t."}
- Uitleg: ${r.description}
${r.suggestion ? `- Concrete suggestie: ${r.suggestion}` : ""}
- id: ${r.id}`
  )
  .join("\n")}

## Origineel artikel (Markdown, ongewijzigd)

Titel: ${article.title ?? "(geen titel gedetecteerd)"}
Woorden: ${article.wordCount}
Afbeeldingen (huidige src + alt):
${article.images
  .slice(0, 15)
  .map((i, idx) => `  [img${idx + 1}] ${i.src.slice(0, 80)} — alt: "${i.alt ?? ""}"`)
  .join("\n")}

---BEGIN ARTIKEL---
${article.markdown}
---EINDE ARTIKEL---

## OUTPUT
Lever JSON. De "rewritten" bevat de VOLLEDIG herschreven Markdown (title + meta +
body). Begin "rewritten" met een metablok in dit formaat:

\`\`\`
---
Titel: [nieuwe title, max 60 tekens]
Meta description: [140-160 tekens]
URL-slug (indien voorstel): [lowercase-hyphens]
Primair keyword: ${primaryKeyword}
---
\`\`\`

Daarna het artikel zelf in gewone Markdown (# H1, ## H2, enz.). Noteer voor elke
afbeelding waar een nieuwe alt nodig is een HTML-comment met de nieuwe alt:
\`<!-- alt: nieuwe beschrijvende alt-tekst -->\` vlak voor de afbeelding. Laat bestaande
afbeeldingen op dezelfde plaats in het artikel staan (link intact).

De "changelog" bevat per aangevinkte aanbeveling één item dat exact beschrijft wat
je veranderd hebt en waar.`;

  return callClaudeJson<RewriteResult>({ system, user, maxTokens: 12000 });
}
