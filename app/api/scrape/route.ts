import { NextRequest, NextResponse } from "next/server";
import { parsePastedMarkdown, scrapeWithJina } from "@/lib/jina";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/scrape
 * Body: { url?: string; markdown?: string }
 * Return: ScrapedArticle
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const url: string | undefined = body.url?.trim();
    const markdown: string | undefined = body.markdown;

    if (!url && !markdown) {
      return NextResponse.json(
        { error: "Geef een URL of de tekst van het artikel mee." },
        { status: 400 }
      );
    }

    const article = url
      ? await scrapeWithJina(url)
      : parsePastedMarkdown(markdown!);

    if (!article.markdown || article.wordCount < 50) {
      return NextResponse.json(
        {
          error:
            "De content lijkt leeg of te kort (minder dan 50 woorden). Check de URL of plak een langer artikel.",
        },
        { status: 422 }
      );
    }

    return NextResponse.json({ article });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
