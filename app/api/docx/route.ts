import { NextRequest, NextResponse } from "next/server";
import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
} from "docx";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/docx
 * Body: { markdown: string, filename?: string }
 * Return: DOCX-bestand als download.
 *
 * We parsen de Markdown naar docx-paragraphs met headings, bold, italic en lijsten.
 * Geen volledige markdown-interpretatie, maar voldoende voor copywriter-gebruik
 * (plakken in Word/Google Docs).
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      markdown?: string;
      filename?: string;
    };
    if (!body.markdown || body.markdown.length < 10) {
      return NextResponse.json(
        { error: "Geen Markdown meegegeven." },
        { status: 400 }
      );
    }

    const doc = buildDocument(body.markdown);
    const buffer = await Packer.toBuffer(doc);
    const filename = sanitizeFilename(body.filename) || `touring-update-${Date.now()}.docx`;

    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buffer.byteLength),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function sanitizeFilename(name: string | undefined): string {
  if (!name) return "";
  const safe = name.replace(/[^\w\-.]+/g, "-").replace(/-+/g, "-");
  return safe.endsWith(".docx") ? safe : `${safe}.docx`;
}

/**
 * Minimal Markdown → docx Paragraph-list.
 * Ondersteunt: H1, H2, H3, bullet lists, numbered lists, blockquote, bold en italic
 * inline, HTML-comment weg, frontmatter weg.
 */
function buildDocument(markdown: string): Document {
  // Strip frontmatter (--- ... ---) indien aanwezig
  const fm = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  const frontmatter = fm ? fm[1] : "";
  const body = fm ? fm[2] : markdown;

  const paragraphs: Paragraph[] = [];

  // Voeg frontmatter als kop + platte regels bovenaan als hij er is
  if (frontmatter.trim()) {
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: "Metadata", bold: true, size: 22 })],
        spacing: { before: 0, after: 100 },
      })
    );
    for (const line of frontmatter.split("\n")) {
      if (!line.trim()) continue;
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: line, size: 20, color: "6B7280" })],
        })
      );
    }
    paragraphs.push(new Paragraph({ children: [new TextRun("")] }));
  }

  const lines = body.split("\n");
  let inCode = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/<!--[^>]*-->/g, "").trimEnd();

    // Codeblocks: gewoon als plain monospace tekst
    if (line.startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: rawLine, font: "Consolas", size: 18 })],
        })
      );
      continue;
    }

    // Lege regel
    if (line.trim() === "") {
      paragraphs.push(new Paragraph({ children: [new TextRun("")] }));
      continue;
    }

    // Horizontale lijn wordt een lege alinea
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      paragraphs.push(new Paragraph({ children: [new TextRun("")] }));
      continue;
    }

    // Koppen
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      const level = h[1].length;
      const headingLevel =
        level === 1
          ? HeadingLevel.HEADING_1
          : level === 2
          ? HeadingLevel.HEADING_2
          : level === 3
          ? HeadingLevel.HEADING_3
          : HeadingLevel.HEADING_4;
      paragraphs.push(
        new Paragraph({
          heading: headingLevel,
          children: renderRuns(h[2]),
        })
      );
      continue;
    }

    // Blockquote (bv. "> Kort antwoord: ...")
    const q = line.match(/^>\s*(.*)$/);
    if (q) {
      paragraphs.push(
        new Paragraph({
          children: renderRuns(q[1]),
          indent: { left: 360 },
          border: {
            left: { color: "003D7A", size: 12, style: "single", space: 8 },
          },
        })
      );
      continue;
    }

    // Bulleted list
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      paragraphs.push(
        new Paragraph({
          bullet: { level: 0 },
          children: renderRuns(bullet[1]),
        })
      );
      continue;
    }

    // Numbered list
    const numbered = line.match(/^\d+\.\s+(.+)$/);
    if (numbered) {
      paragraphs.push(
        new Paragraph({
          numbering: { reference: "numbered", level: 0 },
          children: renderRuns(numbered[1]),
        })
      );
      continue;
    }

    // Normaal paragraafje
    paragraphs.push(new Paragraph({ children: renderRuns(line) }));
  }

  return new Document({
    numbering: {
      config: [
        {
          reference: "numbered",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: "left",
            },
          ],
        },
      ],
    },
    sections: [{ children: paragraphs }],
  });
}

/**
 * Parse inline markdown (bold **x**, italic *x*, links [x](y)) naar TextRun-array.
 * Houdt het bewust simpel — voldoende voor 95% van copy.
 */
function renderRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  // Tokenize: **bold**, *italic*, [link](url), rest
  const regex = /(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIndex) {
      runs.push(new TextRun({ text: text.slice(lastIndex, m.index) }));
    }
    const token = m[0];
    if (token.startsWith("**")) {
      runs.push(new TextRun({ text: token.slice(2, -2), bold: true }));
    } else if (token.startsWith("*")) {
      runs.push(new TextRun({ text: token.slice(1, -1), italics: true }));
    } else if (token.startsWith("[")) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        runs.push(
          new TextRun({
            text: linkMatch[1],
            color: "003D7A",
            underline: {},
          })
        );
      }
    }
    lastIndex = m.index + token.length;
  }
  if (lastIndex < text.length) {
    runs.push(new TextRun({ text: text.slice(lastIndex) }));
  }
  return runs.length > 0 ? runs : [new TextRun({ text })];
}
