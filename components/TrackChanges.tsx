"use client";

import { useMemo, useState } from "react";
import { diffLines } from "diff";
import { renderMarkdown, splitFrontmatter } from "@/lib/markdown";

type Chunk =
  | { type: "unchanged"; value: string }
  | { type: "change"; id: number; removed: string; added: string };

/**
 * Inline "track changes"-view tussen het oorspronkelijke artikel en de finale
 * eindgeredigeerde versie. De gebruiker kan elke wijziging afzonderlijk
 * accepteren of verwerpen. De resulterende tekst wordt live berekend.
 */
export function TrackChanges({
  original,
  revised,
  onExport,
}: {
  original: string;
  revised: string;
  onExport: (resulting: string) => void;
}) {
  // Strip Jina-header en frontmatter uit de orig, frontmatter uit de revised
  const origBody = splitFrontmatter(original).body.trim();
  const { frontmatter, body: revBody } = splitFrontmatter(revised);

  const chunks = useMemo(() => buildChunks(origBody, revBody), [
    origBody,
    revBody,
  ]);

  /** Per wijziging: true = accept revised, false = keep original. Default accept. */
  const [accepted, setAccepted] = useState<Record<number, boolean>>(() => {
    const init: Record<number, boolean> = {};
    for (const c of chunks) if (c.type === "change") init[c.id] = true;
    return init;
  });

  function setAll(value: boolean) {
    const next: Record<number, boolean> = {};
    for (const c of chunks) if (c.type === "change") next[c.id] = value;
    setAccepted(next);
  }

  const resulting = useMemo(
    () => computeResulting(chunks, accepted, frontmatter),
    [chunks, accepted, frontmatter]
  );

  const changeCount = chunks.filter((c) => c.type === "change").length;
  const acceptedCount = Object.values(accepted).filter(Boolean).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-touring-border bg-touring-surface p-3 text-xs">
        <div>
          <strong>{changeCount}</strong> wijzigingen ·{" "}
          <span className="text-green-700">{acceptedCount} geaccepteerd</span>{" "}
          ·{" "}
          <span className="text-slate-500">
            {changeCount - acceptedCount} verworpen
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setAll(true)}
            className="rounded border border-touring-border bg-white px-2 py-1 hover:bg-touring-surface"
          >
            Alles accepteren
          </button>
          <button
            onClick={() => setAll(false)}
            className="rounded border border-touring-border bg-white px-2 py-1 hover:bg-touring-surface"
          >
            Alles verwerpen
          </button>
          <button
            onClick={() => onExport(resulting)}
            className="rounded bg-touring-blue px-3 py-1 font-medium text-white hover:opacity-90"
          >
            Gebruik gecureerde versie
          </button>
        </div>
      </div>

      {changeCount === 0 && (
        <p className="rounded border border-touring-border bg-white p-4 text-sm text-touring-muted">
          Geen verschillen gedetecteerd tussen origineel en finale tekst.
        </p>
      )}

      <div className="space-y-3">
        {chunks.map((chunk, idx) => {
          if (chunk.type === "unchanged") {
            if (!chunk.value.trim()) return null;
            return (
              <div
                key={`u-${idx}`}
                className="prose-tcu rounded border border-transparent p-2 text-sm"
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(chunk.value),
                }}
              />
            );
          }
          const isAccepted = accepted[chunk.id];
          return (
            <div
              key={`c-${chunk.id}`}
              className={
                "rounded border p-3 text-sm transition " +
                (isAccepted
                  ? "border-green-300 bg-green-50"
                  : "border-amber-300 bg-amber-50")
              }
            >
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="font-medium text-touring-muted">
                  Wijziging #{chunk.id + 1}
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() =>
                      setAccepted((s) => ({ ...s, [chunk.id]: true }))
                    }
                    className={
                      "rounded px-2 py-0.5 " +
                      (isAccepted
                        ? "bg-green-600 text-white"
                        : "bg-white border border-touring-border")
                    }
                  >
                    Accepteer
                  </button>
                  <button
                    onClick={() =>
                      setAccepted((s) => ({ ...s, [chunk.id]: false }))
                    }
                    className={
                      "rounded px-2 py-0.5 " +
                      (!isAccepted
                        ? "bg-amber-600 text-white"
                        : "bg-white border border-touring-border")
                    }
                  >
                    Verwerp
                  </button>
                </div>
              </div>

              {chunk.removed.trim() && (
                <div className="mb-1 rounded border border-red-200 bg-red-50 p-2">
                  <div className="mb-0.5 text-[10px] uppercase tracking-wide text-red-700">
                    Origineel
                  </div>
                  <div className="whitespace-pre-wrap font-mono text-xs text-red-900 line-through">
                    {chunk.removed.trim()}
                  </div>
                </div>
              )}
              {chunk.added.trim() && (
                <div className="rounded border border-green-200 bg-white p-2">
                  <div className="mb-0.5 text-[10px] uppercase tracking-wide text-green-700">
                    Voorstel
                  </div>
                  <div className="whitespace-pre-wrap font-mono text-xs text-green-900">
                    {chunk.added.trim()}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <details className="rounded border border-touring-border bg-white p-3 text-xs">
        <summary className="cursor-pointer font-medium">
          Resulterende tekst (live, na accepteren/verwerpen)
        </summary>
        <textarea
          readOnly
          value={resulting}
          rows={18}
          className="mt-2 w-full rounded border border-touring-border bg-touring-surface p-2 font-mono text-[11px]"
        />
      </details>
    </div>
  );
}

function buildChunks(original: string, revised: string): Chunk[] {
  const parts = diffLines(original, revised);
  const chunks: Chunk[] = [];
  let changeId = 0;
  let i = 0;
  while (i < parts.length) {
    const p = parts[i];
    if (!p.added && !p.removed) {
      chunks.push({ type: "unchanged", value: p.value });
      i++;
      continue;
    }
    let removed = "";
    let added = "";
    while (i < parts.length && (parts[i].added || parts[i].removed)) {
      if (parts[i].removed) removed += parts[i].value;
      if (parts[i].added) added += parts[i].value;
      i++;
    }
    chunks.push({ type: "change", id: changeId++, removed, added });
  }
  return chunks;
}

function computeResulting(
  chunks: Chunk[],
  accepted: Record<number, boolean>,
  frontmatter: string
): string {
  const body = chunks
    .map((c) => {
      if (c.type === "unchanged") return c.value;
      return accepted[c.id] ? c.added : c.removed;
    })
    .join("");
  if (frontmatter) return `---\n${frontmatter}\n---\n\n${body}`;
  return body;
}
