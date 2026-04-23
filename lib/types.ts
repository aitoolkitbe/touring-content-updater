/**
 * Shared types voor de Touring Content Updater.
 */

export type RecommendationCategory =
  | "intent_serp"
  | "title_meta"
  | "structure_headings"
  | "first_paragraph"
  | "content_freshness"
  | "geo_optimization"
  | "internal_linking"
  | "images"
  | "schema_markup"
  | "eeat_signals"
  | "technical_hygiene";

export const CATEGORY_LABELS: Record<RecommendationCategory, string> = {
  intent_serp: "Intent & SERP-fit",
  title_meta: "Titel & meta description",
  structure_headings: "Structuur & koppen (H2/H3)",
  first_paragraph: "Eerste alinea (omgekeerde piramide)",
  content_freshness: "Content-actualiteit (Experience / data)",
  geo_optimization: "GEO-optimalisatie (AI-citaties)",
  internal_linking: "Interne linking",
  images: "Beelden: filenames & alt-tekst",
  schema_markup: "Schema markup",
  eeat_signals: "E-E-A-T signalen",
  technical_hygiene: "Technische hygiëne",
};

export type ImpactLevel = "high" | "medium" | "low";

export interface Recommendation {
  /** Stabiele id (uuid of slug), gebruikt bij aanvinken. */
  id: string;
  category: RecommendationCategory;
  /** Korte titel, max ±80 tekens. */
  title: string;
  /** Uitgebreide uitleg van wát te wijzigen en wáárom. */
  description: string;
  /** Concrete "vervang X door Y"-suggestie waar mogelijk. */
  suggestion?: string;
  impact: ImpactLevel;
  /** Waar in de tekst speelt dit (bv. "titel", "H2 over kosten", "alinea 3"). */
  location?: string;
}

export interface SeoContext {
  /** Primaire keyword gedetecteerd in de tekst. */
  primaryKeyword: string;
  /** Secundaire/LSI-keywords. */
  secondaryKeywords: string[];
  /** Gedetecteerde zoekintentie. */
  intent: "informational" | "commercial" | "transactional" | "navigational";
  /** Ahrefs-data indien beschikbaar. */
  ahrefs?: {
    volume: number | null;
    difficulty: number | null;
    cpc: number | null;
    relatedTerms: Array<{ keyword: string; volume: number | null }>;
    serpOverview?: Array<{ url: string; title: string }>;
    warnings?: string[];
  };
}

export interface AnalysisResult {
  /** Samenvatting op hoog niveau. */
  summary: string;
  /** SEO-context: keywords, intent, Ahrefs-data. */
  seo: SeoContext;
  /** Alle aanbevelingen (gegroepeerd per categorie in de UI). */
  recommendations: Recommendation[];
  /** Metadata over het artikel (titel, lengte, laatste update zichtbaar, …). */
  articleMeta: {
    detectedTitle: string | null;
    wordCount: number;
    headingCount: { h1: number; h2: number; h3: number };
    hasDateStamp: boolean;
    imageCount: number;
  };
}

export interface RewriteResult {
  /** Herschreven artikel (Markdown). */
  rewritten: string;
  /** Changelog per toegepaste aanbeveling. */
  changelog: Array<{
    recommendationId: string;
    where: string;
    what: string;
  }>;
}

export interface EditResult {
  /** Finale, eindgeredigeerde versie (Markdown). */
  final: string;
  /** Opgespoorde slop-patronen met verklaring wat verwijderd is. */
  slopFindings: Array<{
    pattern: string;
    snippet: string;
    fix: string;
  }>;
  /** Samenvatting van wat de eindredacteur gedaan heeft. */
  editNotes: string;
}
