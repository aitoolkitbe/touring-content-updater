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
 * TOOL-USE helper voor gegarandeerd gestructureerde output.
 *
 * Claude wordt gedwongen om het gegeven "tool" aan te roepen met een input
 * die exact aan het JSON-schema voldoet. De response komt terug als een
 * parseerde object (geen string-parsing nodig, geen escapings-hickups mogelijk).
 *
 * Dit is fundamenteel robuuster dan vrije JSON-tekst: de API garandeert dat
 * `tool_use.input` een geldig object is dat aan het schema voldoet.
 */
export async function callClaudeTool<T>(params: {
  system: string;
  user: string;
  toolName: string;
  toolDescription: string;
  inputSchema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<T> {
  const client = getAnthropic();
  const response = await client.messages.create({
    model: getModel(),
    max_tokens: params.maxTokens ?? 16000,
    system: params.system,
    tools: [
      {
        name: params.toolName,
        description: params.toolDescription,
        input_schema: params.inputSchema as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: params.toolName },
    messages: [{ role: "user", content: params.user }],
  });

  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    const textBlock = response.content.find((c) => c.type === "text");
    const excerpt =
      textBlock && textBlock.type === "text"
        ? textBlock.text.slice(0, 400)
        : "(geen text block)";
    throw new Error(
      `Claude leverde geen tool_use-response. Stop_reason: ${response.stop_reason}. Excerpt: ${excerpt}`
    );
  }
  return toolUse.input as T;
}

/**
 * Plain JSON-call (voor kleine, simpele responses waar structured output overkill is).
 * Claude's responses zitten soms in ```json ... ``` codeblocks; deze parser is daarvoor robuust.
 */
export async function callClaudeJson<T>(params: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<T> {
  const client = getAnthropic();
  const response = await client.messages.create({
    model: getModel(),
    max_tokens: params.maxTokens ?? 2000,
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
 * Plain tekst-call (voor output die Markdown is).
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
