// Smoke-test: neemt een raw Jina-output-file en draait onze stripping-logic erop.
// Replicatie van lib/jina.ts in JS zodat we geen TS-compiler nodig hebben.

import fs from "node:fs";

const input = fs.readFileSync(process.argv[2], "utf8");

function stripJinaHeader(md) {
  const marker = md.indexOf("Markdown Content:");
  if (marker !== -1) {
    return md.slice(marker + "Markdown Content:".length).trimStart();
  }
  const lines = md.split("\n");
  let i = 0;
  while (
    i < lines.length &&
    /^(Title|URL Source|Published Time|Warning|Markdown Content):/i.test(lines[i])
  )
    i++;
  while (i < lines.length && lines[i].trim() === "") i++;
  return lines.slice(i).join("\n");
}

function extractArticleBody(markdown) {
  let start = 0;
  let end = markdown.length;
  const skipPatterns = [
    /\[[^\]]*(?:overslaan\s+en\s+naar\s+de\s+inhoud|skip\s+to\s+(?:main\s+)?content|naar\s+de\s+inhoud\s+gaan)[^\]]*\]\([^)]+\)/i,
    /\[[^\]]+\]\([^)]*#(?:main-content|maincontent)[^)]*\)/i,
  ];
  let afterSkipIndex = null;
  for (const p of skipPatterns) {
    const m = markdown.match(p);
    if (m && m.index !== undefined) {
      afterSkipIndex = m.index + m[0].length;
      break;
    }
  }
  if (afterSkipIndex !== null) {
    const rest = markdown.slice(afterSkipIndex);
    const h1 = rest.match(/^#\s+.+$/m);
    const h2 = rest.match(/^##\s+.+$/m);
    const firstHeading =
      h1 && (!h2 || (h1.index ?? 0) <= (h2.index ?? Infinity)) ? h1 : h2;
    if (firstHeading && firstHeading.index !== undefined) {
      start = afterSkipIndex + firstHeading.index;
    } else {
      start = afterSkipIndex;
    }
  } else {
    const h1 = markdown.match(/^#\s+.+$/m);
    if (h1 && h1.index !== undefined) start = h1.index;
  }
  const body = markdown.slice(start);
  const endPatterns = [
    /^#{1,3}\s+verwante\s+(?:inhoud|artikel(?:s|en)?)\b/im,
    /^#{1,3}\s+gerelateerde?\s+(?:inhoud|artikel(?:s|en)?)\b/im,
    /^#{1,3}\s+meer\s+(?:lezen|artikels?)\b/im,
    /^#{1,3}\s+related\s+(?:content|articles?|posts?)\b/im,
    /^#{1,3}\s+you\s+may\s+(?:also|like)\b/im,
    /^#{1,3}\s+lees\s+(?:ook|meer)\b/im,
  ];
  for (const p of endPatterns) {
    const m = body.match(p);
    if (m && m.index !== undefined) {
      end = start + m.index;
      break;
    }
  }
  return markdown.slice(start, end).trim();
}

function stripCookieBullets(markdown) {
  const lines = markdown.split("\n");
  const out = [];
  const isCookieBullet = (line) =>
    /^\s*[*-]\s+Cookie\s+\S/i.test(line) ||
    /^\s*[*-]\s+(?:Looptijd|Duration)\s+/i.test(line) ||
    /^\s*[*-]\s+(?:Beschrijving|Description)\s+/i.test(line);
  const isStartOfCookie = (line) => /^\s*[*-]\s+Cookie\s+\S/i.test(line);

  let i = 0;
  while (i < lines.length) {
    if (isStartOfCookie(lines[i])) {
      let cookieCount = 0;
      let j = i;
      while (j < lines.length && j < i + 200) {
        if (isStartOfCookie(lines[j])) cookieCount++;
        if (/^#{1,6}\s+/.test(lines[j])) break;
        j++;
      }
      if (cookieCount >= 2) {
        while (
          i < lines.length &&
          (isCookieBullet(lines[i]) ||
            lines[i].trim() === "" ||
            /^\s*-\s+\[[ xX]\]/.test(lines[i]) ||
            /^\s*(?:Strict\s+noodzakelijk|Functionele\s+cookies|Prestatiecookies|Analytische\s+cookies|Cookies\s+voor\s+|Marketing\s+cookies|Advertising\s+cookies|Always\s+active)/i.test(
              lines[i]
            ))
        )
          i++;
        continue;
      }
    }
    out.push(lines[i]);
    i++;
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function stripCookieBanner(markdown) {
  const patterns = [
    /^.*deze\s+(?:site|website)\s+gebruikt\s+cookies.*$/gim,
    /^.*we\s+gebruiken\s+cookies.*$/gim,
    /^.*ontdek\s+welke\s+cookies.*$/gim,
    /^.*(?:accepteer|weiger)\s+(?:alle|optionele)?\s*cookies.*$/gim,
    /^.*cookievoorkeuren.*$/gim,
    /^.*cookie[- ]instellingen.*$/gim,
    /^.*cookie[- ]beleid.*$/gim,
    /^.*(?:manage|accept)\s+cookies.*$/gim,
    /^.*this\s+website\s+uses\s+cookies.*$/gim,
    /^.*info\s+over\s+het\s+\[(?:privacybeleid|cookiebeleid)\].*$/gim,
    /^.*\[cookiebeleid\].*$/gim,
    /^.*je\s+kan\s+deze\s+instellingen\s+steeds\s+wijzigen.*$/gim,
  ];
  let out = markdown;
  for (const p of patterns) out = out.replace(p, "");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

// ---- PIPELINE ----
let cleaned = stripJinaHeader(input);
console.log("After stripJinaHeader:   ", cleaned.length, "chars");

cleaned = extractArticleBody(cleaned);
console.log("After extractArticleBody:", cleaned.length, "chars");

cleaned = stripCookieBullets(cleaned);
console.log("After stripCookieBullets:", cleaned.length, "chars");

cleaned = stripCookieBanner(cleaned);
console.log("After stripCookieBanner: ", cleaned.length, "chars");

// ---- DIAGNOSTIEK ----
const cookieHits = (cleaned.match(/cookie/gi) || []).length;
const consentHits = (cleaned.match(/\bconsent\b|toestemming/gi) || []).length;
const cky = (cleaned.match(/cky-/gi) || []).length;

console.log("\nDiagnostiek:");
console.log(`  "cookie"   :`, cookieHits);
console.log(`  consent/toestemming:`, consentHits);
console.log(`  "cky-"     :`, cky);

console.log("\n--- Eerste 400 tekens ---");
console.log(cleaned.slice(0, 400));

console.log("\n--- Laatste 400 tekens ---");
console.log(cleaned.slice(-400));

// Telling woorden
const words = cleaned
  .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
  .replace(/\[[^\]]+\]\([^)]+\)/g, "$1")
  .replace(/[#*_`>~-]/g, " ")
  .trim()
  .split(/\s+/)
  .filter(Boolean).length;
console.log(`\nWoordenaantal:`, words);
