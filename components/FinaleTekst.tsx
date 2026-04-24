"use client";

import { useMemo, useState } from "react";
import { renderMarkdown, splitFrontmatter } from "@/lib/markdown";

/**
 * Finale-tekst-viewer: rendered preview + kopieer-opties + download-opties.
 *
 * - "Kopieer als rich text" zet HTML op het klembord — plak netjes in Word,
 *   Google Docs of de meeste CMS'en met rich-text editor.
 * - "Kopieer als Markdown" voor wie de raw Markdown wil.
 * - Downloaden als .md of .docx.
 */
export function FinaleTekst({
  markdown,
  notes,
}: {
  markdown: string;
  notes?: string;
}) {
  const [copied, setCopied] = useState<"rich" | "md" | null>(null);
  const [docxLoading, setDocxLoading] = useState(false);

  const { frontmatter, body } = useMemo(() => splitFrontmatter(markdown), [
    markdown,
  ]);
  const html = useMemo(() => renderMarkdown(body), [body]);

  async function copyRich() {
    try {
      const blobHtml = new Blob([html], { type: "text/html" });
      const blobText = new Blob([stripMarkdown(body)], { type: "text/plain" });
      const item = new ClipboardItem({
        "text/html": blobHtml,
        "text/plain": blobText,
      });
      await navigator.clipboard.write([item]);
      setCopied("rich");
      setTimeout(() => setCopied(null), 1800);
    } catch {
      // Fallback voor browsers die ClipboardItem niet ondersteunen
      await navigator.clipboard.writeText(stripMarkdown(body));
      setCopied("rich");
      setTimeout(() => setCopied(null), 1800);
    }
  }

  async function copyMd() {
    await navigator.clipboard.writeText(markdown);
    setCopied("md");
    setTimeout(() => setCopied(null), 1800);
  }

  function downloadMd() {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `touring-update-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadDocx() {
    setDocxLoading(true);
    try {
      const res = await fetch("/api/docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          markdown,
          filename: `touring-update-${Date.now()}`,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `DOCX-export faalde (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `touring-update-${Date.now()}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setDocxLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {notes && (
        <p className="rounded border border-touring-border bg-touring-surface p-3 text-xs italic text-touring-muted">
          {notes}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={copyRich}
          className="rounded bg-touring-blue px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          {copied === "rich" ? "Gekopieerd" : "Kopieer rich text (voor CMS)"}
        </button>
        <button
          onClick={copyMd}
          className="rounded border border-touring-border bg-white px-3 py-1.5 text-sm hover:bg-touring-surface"
        >
          {copied === "md" ? "Gekopieerd" : "Kopieer Markdown"}
        </button>
        <button
          onClick={downloadDocx}
          disabled={docxLoading}
          className="rounded border border-touring-border bg-white px-3 py-1.5 text-sm hover:bg-touring-surface disabled:opacity-50"
        >
          {docxLoading ? "Genereren..." : "Download .docx"}
        </button>
        <button
          onClick={downloadMd}
          className="rounded border border-touring-border bg-white px-3 py-1.5 text-sm hover:bg-touring-surface"
        >
          Download .md
        </button>
      </div>

      {frontmatter && (
        <div className="rounded border border-touring-border bg-touring-surface p-3 text-xs">
          <div className="mb-1 font-semibold text-touring-muted">Metadata</div>
          <pre className="whitespace-pre-wrap font-mono text-[11px] text-touring-ink">
            {frontmatter}
          </pre>
        </div>
      )}

      <div
        className="prose-tcu rounded border border-touring-border bg-white p-6"
        dangerouslySetInnerHTML={{ __html: html }}
      />

      <details className="rounded border border-touring-border bg-white p-3 text-xs">
        <summary className="cursor-pointer font-medium text-touring-muted">
          Ruwe Markdown tonen
        </summary>
        <textarea
          readOnly
          value={markdown}
          rows={20}
          className="mt-2 w-full rounded border border-touring-border bg-touring-surface p-2 font-mono text-[11px]"
        />
      </details>
    </div>
  );
}

/**
 * Heel simpele fallback-converter: haal markdown-markup weg voor een
 * plain-text clipboard-versie. Niet perfect, maar voldoende wanneer
 * ClipboardItem rich-text faalt.
 */
function stripMarkdown(md: string): string {
  return md
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n");
}
