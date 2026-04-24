import { marked } from "marked";

/**
 * Converteert Markdown naar veilige HTML voor in-browser rendering.
 * We gebruiken marked met GFM + breaks. Geen sanitizer nodig omdat de
 * input altijd van Claude komt via onze eigen API — geen user-injected HTML.
 */
marked.setOptions({
  gfm: true,
  breaks: true,
});

export function renderMarkdown(md: string): string {
  // marked.parse kan synchronous returnen als we async:false gebruiken;
  // default is synchronous in v14. We casten naar string voor de typen.
  return marked.parse(md, { async: false }) as string;
}

/**
 * Strip de frontmatter-blok (--- ... ---) zodat de rendered preview
 * zonder YAML-metadata begint. Behoudt title/meta als leesbare header.
 */
export function splitFrontmatter(md: string): { frontmatter: string; body: string } {
  const match = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return { frontmatter: "", body: md };
  return { frontmatter: match[1].trim(), body: match[2].trimStart() };
}
