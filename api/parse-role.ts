import type { VercelRequest, VercelResponse } from "@vercel/node";
import mammoth from "mammoth";
import { requireStaff, HttpError } from "./_auth.js";
import {
  getAnthropicClient,
  ANTHROPIC_MODEL,
  parseJsonFromMessage,
  textFromContent,
} from "./_anthropic.js";
import { CANONICAL_ROLE_SCHEMA } from "./_schemas.js";

const SYSTEM_PROMPT = `You are a curriculum architect for Venakan, an AI engineering training company.
Given a job description or a free-text role brief, distill it into a canonical role definition.

Return ONLY JSON matching this shape:
- title: the role title (e.g. "AI Application Developer").
- role_family: a short family/grouping (e.g. "Application Engineering", "Data", "Platform").
- primary_stack: the core technologies/tools (array of short strings).
- responsibilities: concrete responsibilities the trainee must be able to perform (array).
- skill_matrix: array of { skill_area, delivered_to } where delivered_to is exactly one of
  "Independent", "Supervised", or "Production-ready under supervision" — the level of autonomy a
  graduate should reach for that skill area.
- milestones: array of { name, indicator } — observable proof points along the journey.

Be specific and faithful to the source. Infer sensible defaults only where the source is silent.`;

/**
 * Staff-only. Parses a JD upload or free-text prompt into a canonical role.
 * Does NOT persist — the client review step saves the confirmed role.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const { admin } = await requireStaff(req);

    const { mode, text, storagePath } = (req.body ?? {}) as {
      mode?: "prompt" | "jd_upload";
      text?: string;
      storagePath?: string;
    };

    if (mode !== "prompt" && mode !== "jd_upload") {
      throw new HttpError(400, "mode must be 'prompt' or 'jd_upload'.");
    }

    const anthropic = getAnthropicClient();

    // Build the user message content (text and/or a PDF document block).
    const userContent: Anthropicpart[] = [];
    let sourceText = "";

    if (mode === "prompt") {
      const clean = (text ?? "").trim();
      if (!clean) throw new HttpError(400, "text is required for prompt mode.");
      sourceText = clean;
      userContent.push({
        type: "text",
        text: `Distill this role brief into the canonical role definition:\n\n${clean}`,
      });
    } else {
      const path = (storagePath ?? "").trim();
      if (!path) {
        throw new HttpError(400, "storagePath is required for jd_upload mode.");
      }
      const { data: blob, error: dlErr } = await admin.storage
        .from("jd-uploads")
        .download(path);
      if (dlErr || !blob) {
        throw new HttpError(400, dlErr?.message ?? "Could not download upload.");
      }
      const buffer = Buffer.from(await blob.arrayBuffer());
      const ext = path.split(".").pop()?.toLowerCase() ?? "";

      if (ext === "pdf") {
        sourceText = `[PDF upload: ${path}]`;
        userContent.push({
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: buffer.toString("base64"),
          },
        });
        userContent.push({
          type: "text",
          text: "Distill the attached job description PDF into the canonical role definition.",
        });
      } else if (ext === "docx") {
        const { value } = await mammoth.extractRawText({ buffer });
        sourceText = value.trim();
        userContent.push({
          type: "text",
          text: `Distill this job description into the canonical role definition:\n\n${sourceText}`,
        });
      } else {
        sourceText = buffer.toString("utf-8").trim();
        userContent.push({
          type: "text",
          text: `Distill this job description into the canonical role definition:\n\n${sourceText}`,
        });
      }
    }

    const message = await anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      output_config: {
        format: { type: "json_schema", schema: CANONICAL_ROLE_SCHEMA },
      },
      messages: [{ role: "user", content: userContent }],
    } as never);

    const raw = textFromContent(
      (message as { content: Array<{ type: string; text?: string }> }).content,
    );

    let role;
    try {
      role = parseJsonFromMessage(raw);
    } catch (err) {
      return res.status(502).json({
        error: err instanceof Error ? err.message : "Bad model output.",
      });
    }

    return res.status(200).json({ role, sourceText });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unexpected error.";
    return res.status(status).json({ error: message });
  }
}

// Loose content-part type to satisfy the SDK's input shape without pulling in
// the full union (PDF document blocks + text blocks).
type Anthropicpart =
  | { type: "text"; text: string }
  | {
      type: "document";
      source: { type: "base64"; media_type: "application/pdf"; data: string };
    };
