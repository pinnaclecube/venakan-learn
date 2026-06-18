import Anthropic from "@anthropic-ai/sdk";

/**
 * Shared Anthropic configuration. SERVER-ONLY — the API key must never reach
 * the client. Files prefixed with "_" are not exposed as Vercel routes.
 */
export const ANTHROPIC_MODEL = "claude-opus-4-8";

let cached: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (cached) return cached;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Server misconfigured: ANTHROPIC_API_KEY is required (server-only).",
    );
  }
  cached = new Anthropic({ apiKey });
  return cached;
}

/**
 * Parse JSON out of a model text response. The output_config json_schema makes
 * the text valid JSON, but we still parse defensively: strip ```json fences and
 * any leading prose before the first `{`/`[`. Throws on failure (callers turn
 * this into an HTTP 502).
 */
export function parseJsonFromMessage<T = unknown>(text: string): T {
  let cleaned = text.trim();

  // Strip a fenced code block if present (```json ... ``` or ``` ... ```).
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    cleaned = fence[1].trim();
  }

  // Drop any leading prose before the first JSON token.
  const firstObj = cleaned.indexOf("{");
  const firstArr = cleaned.indexOf("[");
  const candidates = [firstObj, firstArr].filter((i) => i >= 0);
  if (candidates.length > 0) {
    cleaned = cleaned.slice(Math.min(...candidates));
  }

  // Drop any trailing prose after the last JSON token.
  const lastObj = cleaned.lastIndexOf("}");
  const lastArr = cleaned.lastIndexOf("]");
  const end = Math.max(lastObj, lastArr);
  if (end >= 0) {
    cleaned = cleaned.slice(0, end + 1);
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error("Model returned content that could not be parsed as JSON.");
  }
}

/** Concatenate the text blocks of a message's content array. */
export function textFromContent(
  content: Array<{ type: string; text?: string }>,
): string {
  return content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}
