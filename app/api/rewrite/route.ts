import { NextRequest, NextResponse } from "next/server";
import { callClaudeTool, getModel } from "@/lib/anthropic";
import { TOURING_TOV, TOURING_INTERNAL_LINKS } from "@/lib/knowledge/touring-tov";
import { SEO_EXPERTISE } from "@/lib/knowledge/seo-expertise";
import { REWRITE_SCHEMA } from "@/lib/schemas";
import type { Recommendation, RewriteResult } from "@/lib/types";
import type { ScrapedArticle } from "@/lib/jina";

export const runtime = "nodejs";
// Pro plan: max 300 s. Herschrijven + lange output op Sonnet kan aan 280 s zitten.
// Voor snellere runs: zet ANTHROPIC_MODEL=claude-haiku-4-5-20251001 in Vercel env vars.
export const maxDuration = 290;

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
2. Behoud de STRUCTUUR van het origineel: zelfde paragraaf-volgorde, zelfde H2-volgorde
   waar mogelijk. Voeg alleen secties toe als een aangevinkte aanbeveling dat vraagt
   (bv. "voeg een FAQ toe"). Wijzig bestaande zinnen zo lokaal mogelijk: als er één
   woord moet wijzigen, wijzig alleen dat woord. Dit maakt track-changes-review
   daarna nuttig.
3. Voer ALLEEN de aangevinkte aanbevelingen door. Laat de rest ongemoeid —
   ook zinnen die jij persoonlijk anders zou schrijven.
4. Volg de Touring tone of voice strikt — zie referentie hieronder.
5. Lever het hele artikel als schone Markdown. Inclusief nieuwe title-voorstel,
   meta description, H1, body, nieuwe alt-teksten voor afbeeldingen waar relevant.
6. Geen AI-slop. Geen buzzwords. Geen emoji's. Geen holle openers.
7. Primair keyword: "${primaryKeyword}". Verwerk natuurlijk, 0,5-1,5% densiteit.
8. Secundaire keywords om te verweven: ${secondaryKeywords.join(", ") || "(geen)"}.
9. Interne links: 3-5, uit de meegegeven lijst, alleen als echt relevant.

Roep de tool \`submit_rewrite\` aan met het volledige herschreven artikel en een changelog.

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
Roep \`submit_rewrite\` aan. De "rewritten" bevat de VOLLEDIG herschreven Markdown (title + meta +
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

  return callClaudeTool<RewriteResult>({
    system,
    user,
    toolName: "submit_rewrite",
    toolDescription:
      "Lever het volledig herschreven artikel (Markdown) en een changelog per toegepaste aanbeveling.",
    inputSchema: REWRITE_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 16000,
    // Rewrite blijft op Sonnet — Haiku valt op creatieve copy merkbaar terug.
    model: getModel("rewrite"),
  });
}
