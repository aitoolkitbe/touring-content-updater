# Touring Content Updater

Webtool die oude blogartikelen van touring.be analyseert volgens 2026 SEO- en GEO-best-practices, een aanvinkbare lijst van concrete aanbevelingen produceert, en het artikel herschrijft in de Touring tone of voice — gevolgd door een strenge AI-slop eindredactie.

Stack: Next.js 14 (App Router) · TypeScript · Tailwind · Anthropic SDK · Ahrefs API v3 · Jina AI Reader.

## Hoe de tool werkt

De gebruiker doorloopt een wizard in zes stappen:

1. Input — URL of geplakte tekst van een bestaand artikel.
2. Scraping via Jina Reader → schone Markdown met headings, images, links.
3. Analyse door Claude: keyword-detectie → Ahrefs-data → volledige SEO/GEO-analyse → lijst van 12-25 concrete aanbevelingen in 11 categorieën (intent, title/meta, structuur, eerste alinea, freshness, GEO, interne links, images, schema, E-E-A-T, technisch).
4. Aanvinken — de gebruiker kiest per aanbeveling of ze die wil doorvoeren (standaard: alles met impact "hoog" aangevinkt).
5. Herschrijven — alleen de aangevinkte aanbevelingen worden doorgevoerd, tone of voice blijft dicht bij het origineel, nieuwe title/meta/alt-teksten inbegrepen.
6. Eindredactie — een paranoïde AI-slop-check op banned openers, buzzwords, holle opsommingen, ritme, en eindscore op 10.

De kennis in de prompts zit in `lib/knowledge/`:

- `touring-tov.ts` — gedestilleerd uit de `touring-content-framework` en `touring-blog-writer` skills.
- `seo-expertise.ts` — SEO- en GEO-best-practices 2026 (Ahrefs, Backlinko, Google Search Central, AI-search research).
- `ai-slop-rules.ts` — verboden openers, overgangen, afsluiters, woorden en stijlfiguren.

## Lokaal draaien

Vereist Node 18.17+.

```bash
npm install
cp .env.example .env.local
# .env.local openen en de vier VERPLICHTE variabelen invullen
npm run dev
# open http://localhost:3000 → /login
```

### Environment variables

| Variabele | Verplicht | Waarvoor |
|---|---|---|
| `ANTHROPIC_API_KEY` | ja | Voor alle Claude-calls (analyse, rewrite, editor) |
| `ANTHROPIC_MODEL_ANALYZE` | nee | Default `claude-haiku-4-5-20251001`. Snel voor structuurwerk |
| `ANTHROPIC_MODEL_REWRITE` | nee | Default `claude-sonnet-4-6`. Haiku geeft merkbaar zwakkere copy — niet aanraden |
| `ANTHROPIC_MODEL_EDITOR` | nee | Default `claude-sonnet-4-6`. AI-slop detectie vraagt Sonnet-oordeelsvermogen |
| `ANTHROPIC_MODEL` | nee | Globale fallback voor calls zonder rol |
| `AHREFS_API_TOKEN` | nee | Zonder deze draait de analyse op Claude alleen; geen echte keyword-volumes |
| `AHREFS_COUNTRY` | nee | Default `be` |
| `APP_PASSWORD` | ja | Gedeeld wachtwoord voor `/login` |
| `AUTH_SECRET` | ja | HMAC-secret voor de cookie; genereer met `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `JINA_API_KEY` | nee | Optioneel voor hogere rate-limits op de scraper |
| `NEXT_PUBLIC_APP_URL` | nee | Default `http://localhost:3000` |

### Model-strategie

De drie pipelines hebben elk een eigen karakter:

- **analyze** doet mechanisch structuurwerk — lijst van 12-25 aanbevelingen, semi-deterministisch via tool_use. Haiku 4.5 doet dit 4-5× sneller dan Sonnet zonder kwaliteitsverlies, dus default is Haiku.
- **rewrite** produceert creatieve copy in Touring's tone of voice. Haiku valt hier duidelijk terug. Default is Sonnet 4.6.
- **editor** beoordeelt ritme, clichés en AI-slop. Dit vraagt smaak. Default is Sonnet 4.6.

Als je kwaliteit wil opschroeven op een route waar dat telt, kan je `ANTHROPIC_MODEL_REWRITE` of `ANTHROPIC_MODEL_EDITOR` op `claude-opus-4-6` zetten.

## Deployment op Vercel

1. Push het project naar een nieuwe GitHub-repo:
   ```bash
   git init
   git add .
   git commit -m "initial commit"
   git remote add origin <jouw-repo-url>
   git push -u origin main
   ```

2. Op [vercel.com](https://vercel.com):
   - Klik **Add New → Project**.
   - Selecteer de repo. Vercel detecteert Next.js automatisch.
   - Onder **Environment Variables**: voeg alle verplichte variabelen uit `.env.example` toe (én `AHREFS_API_TOKEN` als je keyword-data wilt).
   - Klik **Deploy**.

3. Na de eerste deploy: open de Vercel-URL → `/login` → voer `APP_PASSWORD` in.

4. Bij wijzigingen: `git push` → Vercel deployt automatisch.

### API-timeouts op Vercel

De `editor` en `rewrite` routes draaien tot 120 s (ingesteld via `maxDuration`). Dat werkt op Vercel Pro of hoger. Op het gratis Hobby-plan is de limiet 60 s — dan kan een zeer lang artikel timen-out-en. Als workaround: gebruik `claude-haiku-4-5-20251001` voor snellere responses, of split de pipeline in twee user-clicks (analyse → rewrite als aparte stappen, wat nu al het geval is voor de UX, maar niet qua edge timeout).

## Architectuur op één blik

```
app/
  layout.tsx               # Header + shell (server component)
  page.tsx                 # Home: laadt <Wizard />
  globals.css              # Tailwind + prose styles
  login/page.tsx           # Password gate
  api/
    auth/route.ts          # POST (login) + DELETE (logout)
    scrape/route.ts        # Jina scraper of paste-parser
    analyze/route.ts       # Keyword-detectie + Ahrefs + volledige analyse
    rewrite/route.ts       # Herschrijven o.b.v. aangevinkte aanbevelingen
    editor/route.ts        # Strenge AI-slop eindredactie
components/
  Wizard.tsx               # Client: alle 6 stappen, state, API-calls
  LogoutButton.tsx         # Client-knopje in de header
lib/
  anthropic.ts             # Claude client + callClaudeJson / callClaudeText
  ahrefs.ts                # Ahrefs v3 client met graceful fallback
  jina.ts                  # Jina Reader + Markdown parser
  types.ts                 # Gedeelde TypeScript-types
  utils.ts                 # cn() + makeId()
  knowledge/
    touring-tov.ts         # Tone of voice (uit Touring-skills)
    seo-expertise.ts       # SEO/GEO-best-practices 2026
    ai-slop-rules.ts       # Paranoïde slop-detectie
middleware.ts              # Signed-cookie passwordgate
```

## Volgende stappen (niet in scope van MVP)

- Frans/Waals-Frans ondersteuning (via de bestaande `touring-magazine-frans` skill als aparte knowledge-module).
- Export naar Google Docs (handoff naar de copywriter).
- Opslag in een DB zodat eerdere analyses terug te halen zijn.
- Batch-mode: 10 URL's in één keer laten analyseren.
- Live preview van het gerenderde artikel in plaats van alleen Markdown.
- A/B-testing van titel-varianten tegen Ahrefs SERP-data.
