import Anthropic from "@anthropic-ai/sdk";

/**
 * Server-only Anthropic client. Nooit importeren in client components.
 */
export function getAnthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY ontbreekt. Zet hem in .env.local (lokaal) of in Vercel Environment Variables."
    );
  }
  return new Anthropic({ apiKey });
}

export function getModel(): string {
  return process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
}

/**
 * Helper die een Claude-call doet en JSON uit het antwoord haalt.
 * Claude's responses zitten soms in ```json ... ``` codeblocks;
 * deze parser is daarvoor robuust.
 */
export async function callClaudeJson<T>(params: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<T> {
  const client = getAnthropic();
  const response = await client.messages.create({
    model: getModel(),
    max_tokens: params.maxTokens ?? 8000,
    system: params.system,
    messages: [{ role: "user", content: params.user }],
  });

  const textBlock = response.content.find((c) => c.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Geen tekst-response van Claude ontvangen.");
  }

  const raw = textBlock.text.trim();
  const jsonString = extractJson(raw);
  try {
    return JSON.parse(jsonString) as T;
  } catch (err) {
    throw new Error(
      `Kon Claude's JSON-antwoord niet parsen. Raw antwoord:\n${raw.slice(0, 500)}\n\nFout: ${err}`
    );
  }
}

/**
 * Plain tekst-call (voor herschrijven en eindredigeren waar de output Markdown is).
 */
export async function callClaudeText(params: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<string> {
  const client = getAnthropic();
  const response = await client.messages.create({
    model: getModel(),
    max_tokens: params.maxTokens ?? 8000,
    system: params.system,
    messages: [{ role: "user", content: params.user }],
  });

  const textBlock = response.content.find((c) => c.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Geen tekst-response van Claude ontvangen.");
  }
  return textBlock.text.trim();
}

function extractJson(raw: string): string {
  // Haal JSON uit ```json ... ``` codeblocks
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();

  // Anders: probeer het eerste { tot het laatste }
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1);
  }
  return raw;
}
