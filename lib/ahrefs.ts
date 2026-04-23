/**
 * Minimale Ahrefs API-client.
 *
 * Ahrefs biedt verschillende API-endpoints; we gebruiken hier de
 * keywords-explorer-overview en keywords-explorer-related-terms voor
 * basisdata. Als er geen token is, returnt de client gracefully een
 * fallback zonder data (de tool werkt dan puur op Claude's kennis).
 *
 * API-documentatie: https://docs.ahrefs.com/
 */

export interface AhrefsKeywordData {
  volume: number | null;
  difficulty: number | null;
  cpc: number | null;
  relatedTerms: Array<{ keyword: string; volume: number | null }>;
  serpOverview?: Array<{ url: string; title: string }>;
  warnings?: string[];
}

export async function getAhrefsKeywordData(
  keyword: string
): Promise<AhrefsKeywordData | null> {
  const token = process.env.AHREFS_API_TOKEN;
  if (!token) {
    return null;
  }

  const country = process.env.AHREFS_COUNTRY || "be";
  const warnings: string[] = [];

  try {
    const overview = await ahrefsCall<{
      keywords?: Array<{
        keyword: string;
        volume: number | null;
        difficulty: number | null;
        cpc: number | null;
      }>;
    }>("keywords-explorer/overview", token, {
      keywords: keyword,
      country,
      select: "keyword,volume,difficulty,cpc",
    });

    const first = overview.keywords?.[0];

    const related = await ahrefsCall<{
      keywords?: Array<{ keyword: string; volume: number | null }>;
    }>("keywords-explorer/related-terms", token, {
      keyword,
      country,
      select: "keyword,volume",
      limit: "10",
    }).catch((err) => {
      warnings.push(`related-terms call faalde: ${String(err).slice(0, 100)}`);
      return { keywords: [] };
    });

    return {
      volume: first?.volume ?? null,
      difficulty: first?.difficulty ?? null,
      cpc: first?.cpc ?? null,
      relatedTerms: (related.keywords || []).map((k) => ({
        keyword: k.keyword,
        volume: k.volume ?? null,
      })),
      warnings: warnings.length ? warnings : undefined,
    };
  } catch (err) {
    return {
      volume: null,
      difficulty: null,
      cpc: null,
      relatedTerms: [],
      warnings: [`Ahrefs API-fout: ${String(err).slice(0, 200)}`],
    };
  }
}

async function ahrefsCall<T>(
  path: string,
  token: string,
  params: Record<string, string>
): Promise<T> {
  const url = new URL(`https://api.ahrefs.com/v3/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ahrefs ${path} gaf status ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}
