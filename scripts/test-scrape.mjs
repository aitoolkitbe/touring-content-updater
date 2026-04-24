// Smoke-test script voor de Jina scraper.
// Draai met: node scripts/test-scrape.mjs <optional-url>
// Geen build nodig: we importeren de TypeScript source via tsx of via een
// eenvoudige replicatie van de logica hier.

import { register } from "node:module";
import { pathToFileURL } from "node:url";

// Gebruik tsx-loader als beschikbaar, anders transpileer via dynamische import
try {
  register("tsx/esm", pathToFileURL("./"));
} catch {}

const URL_TO_TEST =
  process.argv[2] ||
  "https://www.touring.be/nl/artikels/met-de-elektrische-auto-stressvrij-naar-het-zuiden";

const { scrapeWithJina } = await import("../lib/jina.ts");

console.log(`\nScraping: ${URL_TO_TEST}\n`);
const art = await scrapeWithJina(URL_TO_TEST);

console.log(`Title:      ${art.title}`);
console.log(`Word count: ${art.wordCount}`);
console.log(`Images:     ${art.images.length}`);
console.log(`Headings:   ${art.headings.length}`);
console.log(`Links:      ${art.links.length}`);
console.log(`Date stamp: ${art.hasDateStamp}`);

console.log("\n--- Eerste 3 H2/H3 koppen ---");
for (const h of art.headings.slice(0, 5)) {
  console.log(`  H${h.level}: ${h.text}`);
}

console.log("\n--- Eerste 500 tekens van de body ---");
console.log(art.markdown.slice(0, 500));

console.log("\n--- Laatste 500 tekens van de body ---");
console.log(art.markdown.slice(-500));

// Screening: zoek naar cookie-content als sanity check
const cookieHits = (art.markdown.match(/cookie/gi) || []).length;
console.log(`\n"cookie"-vermeldingen in body: ${cookieHits}`);
if (cookieHits > 5) {
  console.log("WAARSCHUWING: mogelijk zit er nog cookie-content in.");
}

const consentHits = (art.markdown.match(/\bconsent\b|toestemming/gi) || []).length;
console.log(`Consent/toestemming-vermeldingen: ${consentHits}`);
