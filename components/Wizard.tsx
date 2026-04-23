"use client";

import { useMemo, useState } from "react";
import type { ScrapedArticle } from "@/lib/jina";
import type {
  AnalysisResult,
  EditResult,
  Recommendation,
  RecommendationCategory,
  RewriteResult,
} from "@/lib/types";
import { CATEGORY_LABELS } from "@/lib/types";

type Step =
  | "input"
  | "scraping"
  | "analyzing"
  | "recommendations"
  | "rewriting"
  | "editing"
  | "done";

export function Wizard() {
  const [step, setStep] = useState<Step>("input");
  const [mode, setMode] = useState<"url" | "paste">("url");
  const [url, setUrl] = useState("https://www.touring.be/nl/artikels/");
  const [pasted, setPasted] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [article, setArticle] = useState<ScrapedArticle | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rewrite, setRewrite] = useState<RewriteResult | null>(null);
  const [edited, setEdited] = useState<EditResult | null>(null);

  function resetFromStart() {
    setStep("input");
    setArticle(null);
    setAnalysis(null);
    setSelected(new Set());
    setRewrite(null);
    setEdited(null);
    setError(null);
  }

  async function handleAnalyze() {
    setError(null);
    if (mode === "url" && !/^https?:\/\/\S+/.test(url)) {
      setError("Voer een geldige URL in.");
      return;
    }
    if (mode === "paste" && pasted.trim().length < 200) {
      setError("Plak minstens 200 tekens content.");
      return;
    }

    try {
      setStep("scraping");
      const scrapeRes = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "url" ? { url } : { markdown: pasted }
        ),
      });
      if (!scrapeRes.ok) {
        const data = await scrapeRes.json().catch(() => ({}));
        throw new Error(data.error || `Scrape faalde (${scrapeRes.status})`);
      }
      const { article: art } = (await scrapeRes.json()) as {
        article: ScrapedArticle;
      };
      setArticle(art);

      setStep("analyzing");
      const anRes = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ article: art }),
      });
      if (!anRes.ok) {
        const data = await anRes.json().catch(() => ({}));
        throw new Error(data.error || `Analyse faalde (${anRes.status})`);
      }
      const { analysis: an } = (await anRes.json()) as {
        analysis: AnalysisResult;
      };
      setAnalysis(an);
      // Standaard: alle 'high' impact aanvinken
      const defaultSelected = new Set(
        an.recommendations.filter((r) => r.impact === "high").map((r) => r.id)
      );
      setSelected(defaultSelected);
      setStep("recommendations");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("input");
    }
  }

  async function handleRewrite() {
    if (!article || !analysis) return;
    if (selected.size === 0) {
      setError("Vink minstens één aanbeveling aan.");
      return;
    }
    setError(null);
    try {
      setStep("rewriting");
      const selectedRecs = analysis.recommendations.filter((r) =>
        selected.has(r.id)
      );
      const res = await fetch("/api/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          article,
          selected: selectedRecs,
          primaryKeyword: analysis.seo.primaryKeyword,
          secondaryKeywords: analysis.seo.secondaryKeywords,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Rewrite faalde (${res.status})`);
      }
      const { result } = (await res.json()) as { result: RewriteResult };
      setRewrite(result);

      setStep("editing");
      const edRes = await fetch("/api/editor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rewritten: result.rewritten }),
      });
      if (!edRes.ok) {
        const data = await edRes.json().catch(() => ({}));
        throw new Error(data.error || `Eindredactie faalde (${edRes.status})`);
      }
      const { result: edResult } = (await edRes.json()) as {
        result: EditResult;
      };
      setEdited(edResult);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("recommendations");
    }
  }

  const grouped = useMemo(() => {
    if (!analysis) return new Map<RecommendationCategory, Recommendation[]>();
    const map = new Map<RecommendationCategory, Recommendation[]>();
    for (const rec of analysis.recommendations) {
      const list = map.get(rec.category) || [];
      list.push(rec);
      map.set(rec.category, list);
    }
    return map;
  }, [analysis]);

  return (
    <div className="space-y-6">
      <Stepper step={step} />

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong className="font-semibold">Probleem:</strong> {error}
        </div>
      )}

      {step === "input" && (
        <InputCard
          mode={mode}
          setMode={setMode}
          url={url}
          setUrl={setUrl}
          pasted={pasted}
          setPasted={setPasted}
          onStart={handleAnalyze}
        />
      )}

      {(step === "scraping" || step === "analyzing") && (
        <LoadingCard
          title={step === "scraping" ? "Artikel ophalen..." : "Volledige SEO- en GEO-analyse..."}
          subtitle={
            step === "scraping"
              ? "Jina Reader haalt de inhoud binnen en we parseren de structuur."
              : "We halen Ahrefs-data op, detecteren intent en genereren concrete aanbevelingen."
          }
        />
      )}

      {step === "recommendations" && analysis && (
        <RecommendationsView
          analysis={analysis}
          grouped={grouped}
          selected={selected}
          setSelected={setSelected}
          onConfirm={handleRewrite}
          onReset={resetFromStart}
        />
      )}

      {(step === "rewriting" || step === "editing") && (
        <LoadingCard
          title={step === "rewriting" ? "Herschrijven..." : "Eindredactie en AI-slop check..."}
          subtitle={
            step === "rewriting"
              ? "We voeren alleen de aangevinkte aanbevelingen door en houden de toon dicht bij het origineel."
              : "De paranoïde eindredacteur snoeit buzzwords, holle frasen en AI-patronen."
          }
        />
      )}

      {step === "done" && rewrite && edited && analysis && (
        <DoneView
          rewrite={rewrite}
          edited={edited}
          analysis={analysis}
          onReset={resetFromStart}
        />
      )}
    </div>
  );
}

/* --------------------------- Stepper --------------------------- */

function Stepper({ step }: { step: Step }) {
  const labels: [Step, string][] = [
    ["input", "1. Input"],
    ["analyzing", "2. Analyse"],
    ["recommendations", "3. Aanbevelingen"],
    ["rewriting", "4. Herschrijven"],
    ["editing", "5. Eindredactie"],
    ["done", "6. Resultaat"],
  ];
  const activeIndex = labels.findIndex(([s]) =>
    step === "scraping" && s === "analyzing"
      ? true
      : step === s
  );
  return (
    <ol className="flex flex-wrap gap-2 text-xs font-medium">
      {labels.map(([s, label], idx) => {
        const isActive = idx === activeIndex;
        const isDone = idx < activeIndex;
        return (
          <li
            key={s}
            className={
              "rounded px-3 py-1.5 " +
              (isActive
                ? "bg-touring-blue text-white"
                : isDone
                ? "bg-touring-blue/10 text-touring-blue"
                : "bg-white text-touring-muted border border-touring-border")
            }
          >
            {label}
          </li>
        );
      })}
    </ol>
  );
}

/* --------------------------- Input --------------------------- */

function InputCard(props: {
  mode: "url" | "paste";
  setMode: (m: "url" | "paste") => void;
  url: string;
  setUrl: (v: string) => void;
  pasted: string;
  setPasted: (v: string) => void;
  onStart: () => void;
}) {
  return (
    <div className="rounded-lg border border-touring-border bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold">Wat wil je updaten?</h2>
      <p className="mt-1 text-sm text-touring-muted">
        Geef de URL van een bestaand touring.be-artikel, of plak de tekst rechtstreeks.
      </p>

      <div className="mt-4 flex gap-2">
        <TabButton active={props.mode === "url"} onClick={() => props.setMode("url")}>
          Via URL
        </TabButton>
        <TabButton active={props.mode === "paste"} onClick={() => props.setMode("paste")}>
          Tekst plakken
        </TabButton>
      </div>

      {props.mode === "url" ? (
        <input
          type="url"
          value={props.url}
          onChange={(e) => props.setUrl(e.target.value)}
          placeholder="https://www.touring.be/nl/artikels/..."
          className="mt-4 w-full rounded border border-touring-border px-3 py-2 text-sm focus:border-touring-blue focus:outline-none"
        />
      ) : (
        <textarea
          value={props.pasted}
          onChange={(e) => props.setPasted(e.target.value)}
          placeholder="Plak hier de volledige tekst van het artikel (Markdown of platte tekst)..."
          rows={14}
          className="mt-4 w-full rounded border border-touring-border px-3 py-2 font-mono text-xs focus:border-touring-blue focus:outline-none"
        />
      )}

      <button
        onClick={props.onStart}
        className="mt-4 rounded bg-touring-blue px-5 py-2 text-sm font-medium text-white hover:opacity-90"
      >
        Start analyse
      </button>

      <p className="mt-3 text-xs text-touring-muted">
        Tip: de analyse duurt 30-60 seconden. Ahrefs-data wordt opgehaald als
        je token geconfigureerd is.
      </p>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "rounded px-3 py-1.5 text-sm " +
        (active
          ? "bg-touring-blue text-white"
          : "bg-touring-surface text-touring-ink border border-touring-border hover:bg-white")
      }
    >
      {children}
    </button>
  );
}

/* --------------------------- Loading --------------------------- */

function LoadingCard({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-touring-border bg-white p-6 shadow-sm">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-touring-blue border-t-transparent" />
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-sm text-touring-muted">{subtitle}</p>
      </div>
    </div>
  );
}

/* --------------------------- Recommendations --------------------------- */

function RecommendationsView(props: {
  analysis: AnalysisResult;
  grouped: Map<RecommendationCategory, Recommendation[]>;
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  onConfirm: () => void;
  onReset: () => void;
}) {
  const { analysis, grouped, selected, setSelected, onConfirm, onReset } = props;

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function selectAll(category?: RecommendationCategory) {
    const next = new Set(selected);
    for (const r of analysis.recommendations) {
      if (!category || r.category === category) next.add(r.id);
    }
    setSelected(next);
  }
  function deselectAll(category?: RecommendationCategory) {
    const next = new Set(selected);
    for (const r of analysis.recommendations) {
      if (!category || r.category === category) next.delete(r.id);
    }
    setSelected(next);
  }

  const totalHigh = analysis.recommendations.filter((r) => r.impact === "high").length;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-touring-border bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold">Analyse-samenvatting</h2>
        <p className="mt-2 text-sm leading-relaxed">{analysis.summary}</p>

        <div className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <Stat label="Primair keyword" value={analysis.seo.primaryKeyword} />
          <Stat label="Zoekintentie" value={analysis.seo.intent} />
          <Stat label="Woordenaantal" value={String(analysis.articleMeta.wordCount)} />
          <Stat
            label="Afbeeldingen"
            value={String(analysis.articleMeta.imageCount)}
          />
        </div>

        {analysis.seo.ahrefs && (
          <div className="mt-4 rounded border border-touring-border bg-touring-surface p-3 text-xs text-touring-ink">
            <strong>Ahrefs (BE):</strong>{" "}
            Volume {analysis.seo.ahrefs.volume ?? "?"} · KD{" "}
            {analysis.seo.ahrefs.difficulty ?? "?"} · CPC{" "}
            {analysis.seo.ahrefs.cpc ?? "?"}
            {analysis.seo.ahrefs.relatedTerms.length > 0 && (
              <div className="mt-1">
                Related:{" "}
                {analysis.seo.ahrefs.relatedTerms
                  .slice(0, 6)
                  .map((r) => r.keyword)
                  .join(" · ")}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-touring-border bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Aanbevelingen</h2>
            <p className="text-xs text-touring-muted">
              {analysis.recommendations.length} in totaal · {totalHigh} hoge
              impact · {selected.size} aangevinkt
            </p>
          </div>
          <div className="flex gap-2 text-xs">
            <button
              onClick={() => selectAll()}
              className="rounded border border-touring-border bg-white px-2 py-1 hover:bg-touring-surface"
            >
              Alles aan
            </button>
            <button
              onClick={() => deselectAll()}
              className="rounded border border-touring-border bg-white px-2 py-1 hover:bg-touring-surface"
            >
              Alles uit
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-6">
          {Array.from(grouped.entries()).map(([cat, recs]) => (
            <div key={cat}>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-touring-blue">
                  {CATEGORY_LABELS[cat]}
                </h3>
                <div className="flex gap-1 text-[10px] text-touring-muted">
                  <button
                    onClick={() => selectAll(cat)}
                    className="hover:text-touring-blue"
                  >
                    aan
                  </button>
                  <span>·</span>
                  <button
                    onClick={() => deselectAll(cat)}
                    className="hover:text-touring-blue"
                  >
                    uit
                  </button>
                </div>
              </div>
              <ul className="space-y-2">
                {recs.map((r) => (
                  <li
                    key={r.id}
                    className="rounded border border-touring-border bg-touring-surface p-3"
                  >
                    <label className="flex gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggle(r.id)}
                        className="mt-0.5 h-4 w-4 accent-touring-blue"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{r.title}</span>
                          <ImpactBadge impact={r.impact} />
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-touring-ink/80">
                          {r.description}
                        </p>
                        {r.suggestion && (
                          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-white p-2 text-[11px] text-touring-ink border border-touring-border">
                            {r.suggestion}
                          </pre>
                        )}
                        {r.location && (
                          <p className="mt-1 text-[11px] text-touring-muted">
                            Locatie: {r.location}
                          </p>
                        )}
                      </div>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-6 flex justify-between">
          <button
            onClick={onReset}
            className="rounded border border-touring-border bg-white px-4 py-2 text-sm hover:bg-touring-surface"
          >
            Opnieuw beginnen
          </button>
          <button
            onClick={onConfirm}
            disabled={selected.size === 0}
            className="rounded bg-touring-blue px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Herschrijf met {selected.size} aanpassing
            {selected.size === 1 ? "" : "en"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-touring-border bg-touring-surface p-3">
      <div className="text-[11px] uppercase tracking-wide text-touring-muted">
        {label}
      </div>
      <div className="mt-0.5 truncate font-medium">{value}</div>
    </div>
  );
}

function ImpactBadge({ impact }: { impact: "high" | "medium" | "low" }) {
  const styles =
    impact === "high"
      ? "bg-red-100 text-red-800"
      : impact === "medium"
      ? "bg-amber-100 text-amber-800"
      : "bg-slate-100 text-slate-700";
  const label = impact === "high" ? "hoog" : impact === "medium" ? "medium" : "laag";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${styles}`}>
      impact: {label}
    </span>
  );
}

/* --------------------------- Done --------------------------- */

function DoneView(props: {
  rewrite: RewriteResult;
  edited: EditResult;
  analysis: AnalysisResult;
  onReset: () => void;
}) {
  const [tab, setTab] = useState<"final" | "changelog" | "slop" | "compare">(
    "final"
  );
  const [copied, setCopied] = useState(false);

  async function copyFinal() {
    await navigator.clipboard.writeText(props.edited.final);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function download() {
    const blob = new Blob([props.edited.final], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `touring-update-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-touring-border bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Klaar.</h2>
            <p className="text-xs text-touring-muted">
              Herschreven én eindgeredigeerd. Kopieer, download of bekijk de
              wijzigingen.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={copyFinal}
              className="rounded bg-touring-blue px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              {copied ? "Gekopieerd" : "Kopieer Markdown"}
            </button>
            <button
              onClick={download}
              className="rounded border border-touring-border bg-white px-3 py-1.5 text-sm hover:bg-touring-surface"
            >
              Download .md
            </button>
            <button
              onClick={props.onReset}
              className="rounded border border-touring-border bg-white px-3 py-1.5 text-sm hover:bg-touring-surface"
            >
              Nieuw artikel
            </button>
          </div>
        </div>

        <div className="mt-4 flex gap-2 border-b border-touring-border text-sm">
          {(
            [
              ["final", "Finale tekst"],
              ["changelog", `Wijzigingen (${props.rewrite.changelog.length})`],
              ["slop", `AI-slop (${props.edited.slopFindings.length})`],
              ["compare", "Vergelijk met origineel"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={
                "border-b-2 px-3 py-2 " +
                (tab === key
                  ? "border-touring-blue font-medium text-touring-blue"
                  : "border-transparent text-touring-muted hover:text-touring-ink")
              }
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {tab === "final" && (
            <div>
              <p className="mb-2 text-xs italic text-touring-muted">
                {props.edited.editNotes}
              </p>
              <textarea
                readOnly
                value={props.edited.final}
                rows={28}
                className="w-full rounded border border-touring-border bg-touring-surface p-3 font-mono text-xs"
              />
            </div>
          )}

          {tab === "changelog" && (
            <ul className="space-y-2">
              {props.rewrite.changelog.map((c, i) => (
                <li
                  key={i}
                  className="rounded border border-touring-border bg-touring-surface p-3 text-sm"
                >
                  <div className="text-xs text-touring-muted">{c.where}</div>
                  <div className="mt-1">{c.what}</div>
                </li>
              ))}
            </ul>
          )}

          {tab === "slop" && (
            <ul className="space-y-2">
              {props.edited.slopFindings.map((s, i) => (
                <li
                  key={i}
                  className="rounded border border-touring-border bg-touring-surface p-3 text-sm"
                >
                  <div className="text-xs font-semibold text-red-700">
                    {s.pattern}
                  </div>
                  <div className="mt-1">
                    <span className="text-xs text-touring-muted">Uit:</span>{" "}
                    <span className="font-mono text-xs">&ldquo;{s.snippet}&rdquo;</span>
                  </div>
                  <div className="mt-1">
                    <span className="text-xs text-touring-muted">Fix:</span>{" "}
                    <span className="font-mono text-xs">&ldquo;{s.fix}&rdquo;</span>
                  </div>
                </li>
              ))}
              {props.edited.slopFindings.length === 0 && (
                <li className="text-sm text-touring-muted">
                  Geen AI-slop gevonden. (Dat is zeldzaam — verifieer handmatig.)
                </li>
              )}
            </ul>
          )}

          {tab === "compare" && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-semibold text-touring-muted">
                  Herschreven (pre-eindredactie)
                </div>
                <textarea
                  readOnly
                  value={props.rewrite.rewritten}
                  rows={24}
                  className="w-full rounded border border-touring-border bg-touring-surface p-2 font-mono text-[11px]"
                />
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold text-touring-muted">
                  Finale tekst (na eindredactie)
                </div>
                <textarea
                  readOnly
                  value={props.edited.final}
                  rows={24}
                  className="w-full rounded border border-touring-border bg-touring-surface p-2 font-mono text-[11px]"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
