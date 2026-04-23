import { NextRequest, NextResponse } from "next/server";
import { callClaudeTool, getModel } from "@/lib/anthropic";
import { TOURING_TOV } from "@/lib/knowledge/touring-tov";
import { AI_SLOP_RULES } from "@/lib/knowledge/ai-slop-rules";
import { EDIT_SCHEMA } from "@/lib/schemas";
import type { EditResult } from "@/lib/types";

export const runtime = "nodejs";
// Pro plan: max 300 s. Eindredactie + volledig herschreven artikel outputten kan 2-4 min op Sonnet.
// Voor snellere runs: zet ANTHROPIC_MODEL=claude-haiku-4-5-20251001 in Vercel env vars.
export const maxDuration = 290;

/**
 * POST /api/editor
 * Body: { rewritten: string }
 * Return: EditResult
 *
 * De eindredacteur past een paranoïde AI-slop check toe, verfijnt ritme en
 * zinsbouw, en levert de finale tekst + een redactierapport.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { rewritten: string };
    if (!body.rewritten) {
      return NextResponse.json(
        { error: "Geen herschreven tekst meegegeven." },
        { status: 400 }
      );
    }

    const result = await edit(body.rewritten);
    return NextResponse.json({ result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function edit(rewritten: string): Promise<EditResult> {
  const system = `Je bent een genadeloze eindredacteur voor Touring. Je staat bekend om
je obsessie voor AI-slop: je herkent elk patroon, elke holle opener, elk
buzzword, elke lege opsomming. Je bent niet creatief — je snoeit, schrapt en
polijst. De tekst moet onderscheidbaar zijn van AI-gegenereerde content.

Roep de tool \`submit_edit\` aan met de finale tekst, je slop-findings en je edit-notes.

## REFERENTIE 1 — AI-SLOP REGELS
${AI_SLOP_RULES}

## REFERENTIE 2 — TOURING TONE OF VOICE
${TOURING_TOV}`;

  const user = `# HERSCHREVEN TEKST OM TE REDIGEREN

${rewritten}

---

# OPDRACHT

1. Lees de tekst woord voor woord.
2. Markeer elk AI-slop patroon uit de regels hierboven. Minimum 3, realistisch vaak 8-20.
3. Herschrijf die passages in de Touring-stijl: concreet, feitelijk, menselijk.
4. Bewaak ritme: geen 3+ opeenvolgende zinnen met identieke structuur, geen 4+ zinnen onder 8 woorden op rij.
5. Behoud de structuur en boodschap van het herschreven artikel. Geen nieuwe feiten toevoegen.
6. Behoud de Markdown-structuur (title/meta frontmatter, H1/H2/H3, lijsten, links, image comments).
7. Schat een eindscore voor AI-slop-vrijheid op 10 (10 = onaanraakbaar, 8 = goed, 6 = herwerken). Noem die score in editNotes.

Roep \`submit_edit\` aan.`;

  return callClaudeTool<EditResult>({
    system,
    user,
    toolName: "submit_edit",
    toolDescription:
      "Lever de finale geredigeerde Markdown, een lijst van gevonden AI-slop-patronen en een korte redactienotitie.",
    inputSchema: EDIT_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 16000,
    // Editor blijft op Sonnet — AI-slop detectie vraagt fijn oordeelsvermogen.
    model: getModel("editor"),
  });
}
