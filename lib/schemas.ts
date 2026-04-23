/**
 * JSON-schemas die we meegeven aan Claude via tool_use.
 * De API valideert dat de gegenereerde input aan deze schemas voldoet,
 * waardoor we nooit een parse-error krijgen op de client-kant.
 */

const CATEGORIES = [
  "intent_serp",
  "title_meta",
  "structure_headings",
  "first_paragraph",
  "content_freshness",
  "geo_optimization",
  "internal_linking",
  "images",
  "schema_markup",
  "eeat_signals",
  "technical_hygiene",
] as const;

export const ANALYSIS_SCHEMA = {
  type: "object",
  required: ["summary", "seo", "articleMeta", "recommendations"],
  properties: {
    summary: {
      type: "string",
      description:
        "2-4 zinnen samenvatting van de huidige staat van het artikel en de grootste update-kansen.",
    },
    seo: {
      type: "object",
      required: ["primaryKeyword", "secondaryKeywords", "intent"],
      properties: {
        primaryKeyword: { type: "string" },
        secondaryKeywords: {
          type: "array",
          items: { type: "string" },
        },
        intent: {
          type: "string",
          enum: [
            "informational",
            "commercial",
            "transactional",
            "navigational",
          ],
        },
      },
    },
    articleMeta: {
      type: "object",
      required: ["wordCount", "headingCount", "hasDateStamp", "imageCount"],
      properties: {
        detectedTitle: { type: ["string", "null"] },
        wordCount: { type: "integer" },
        headingCount: {
          type: "object",
          required: ["h1", "h2", "h3"],
          properties: {
            h1: { type: "integer" },
            h2: { type: "integer" },
            h3: { type: "integer" },
          },
        },
        hasDateStamp: { type: "boolean" },
        imageCount: { type: "integer" },
      },
    },
    recommendations: {
      type: "array",
      minItems: 12,
      maxItems: 25,
      items: {
        type: "object",
        required: ["id", "category", "title", "description", "impact"],
        properties: {
          id: {
            type: "string",
            description: "Stabiele korte slug-id.",
          },
          category: {
            type: "string",
            enum: CATEGORIES as unknown as string[],
          },
          title: {
            type: "string",
            description: "Korte, actiegerichte titel. Max 80 tekens.",
          },
          description: {
            type: "string",
            description:
              "2-5 zinnen: wat is het probleem en waarom telt het.",
          },
          suggestion: {
            type: "string",
            description:
              "Optioneel: concrete voor/na-voorbeeld of tekstfragment.",
          },
          impact: {
            type: "string",
            enum: ["high", "medium", "low"],
          },
          location: {
            type: "string",
            description:
              "Optioneel: waar in het artikel (bv. 'titel', 'H2 over kosten', 'alinea 3').",
          },
        },
      },
    },
  },
} as const;

export const REWRITE_SCHEMA = {
  type: "object",
  required: ["rewritten", "changelog"],
  properties: {
    rewritten: {
      type: "string",
      description:
        "Het VOLLEDIG herschreven artikel in Markdown. Begint met een frontmatter-blok tussen --- delimiters met Titel, Meta description, URL-slug en Primair keyword. Daarna H1, body met H2/H3, lijsten, links, en <!-- alt: ... --> HTML-comments vlak voor afbeeldingen.",
    },
    changelog: {
      type: "array",
      items: {
        type: "object",
        required: ["recommendationId", "where", "what"],
        properties: {
          recommendationId: { type: "string" },
          where: {
            type: "string",
            description: "Korte locatie (bv. 'titel', 'H2 #3', 'alt van img3').",
          },
          what: {
            type: "string",
            description: "Wat er concreet is gewijzigd.",
          },
        },
      },
    },
  },
} as const;

export const EDIT_SCHEMA = {
  type: "object",
  required: ["final", "slopFindings", "editNotes"],
  properties: {
    final: {
      type: "string",
      description:
        "De finale, geredigeerde Markdown. Behoudt title/meta frontmatter, H1/H2/H3, lijsten, links, en <!-- alt: ... --> comments.",
    },
    slopFindings: {
      type: "array",
      items: {
        type: "object",
        required: ["pattern", "snippet", "fix"],
        properties: {
          pattern: {
            type: "string",
            description: "Naam van het AI-slop-patroon (bv. 'holle opener', 'buzzword', 'lege opsomming').",
          },
          snippet: {
            type: "string",
            description: "Geciteerde originele frase die verwijderd/veranderd is.",
          },
          fix: {
            type: "string",
            description: "Wat de eindredacteur ervan gemaakt heeft.",
          },
        },
      },
    },
    editNotes: {
      type: "string",
      description:
        "2-5 zinnen globale notities. Vermeld de eindscore op 10 voor AI-slop-vrijheid.",
    },
  },
} as const;

export const KEYWORD_DETECTION_SCHEMA = {
  type: "object",
  required: ["primaryKeyword", "secondaryKeywords", "intent"],
  properties: {
    primaryKeyword: {
      type: "string",
      description: "1 tot 4 woorden, het hoofd-zoekwoord dat de lezer intypt.",
    },
    secondaryKeywords: {
      type: "array",
      minItems: 3,
      maxItems: 6,
      items: { type: "string" },
    },
    intent: {
      type: "string",
      enum: ["informational", "commercial", "transactional", "navigational"],
    },
  },
} as const;
