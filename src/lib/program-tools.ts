import { supabase } from "./supabase";
import type { GateType, Rubric } from "./generation";
import type { LessonBlock } from "./runtime";

// ---------------------------------------------------------------------------
// Compare / apply types (mirror api/compare-program.ts + 0007 RPC)
// ---------------------------------------------------------------------------
export type CompareOp =
  | "modify_module"
  | "add_module"
  | "remove_module"
  | "modify_exercise";

export interface CompareSuggestionFields {
  title?: string;
  objectives?: string[];
  materials?: string;
  gate_type?: GateType;
  lesson?: LessonBlock[];
  prompt?: string;
  rubric?: Rubric;
}

export interface CompareSuggestion {
  id: string;
  op: CompareOp;
  target_module_order?: number;
  target_exercise_index?: number;
  title: string;
  rationale: string;
  fields?: CompareSuggestionFields;
}

export interface CompareResult {
  summary: string;
  suggestions: CompareSuggestion[];
}

export interface ComparePayload {
  mode: "upload" | "text";
  storagePath?: string;
  text?: string;
}

export type ExportFormat = "docx" | "pdf";

// ---------------------------------------------------------------------------
// Authed JSON fetch (mirrors the pattern in lib/api.ts / lib/generation.ts)
// ---------------------------------------------------------------------------
async function authedJson<T>(path: string, body: unknown): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated.");

  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) {
    throw new Error(json.error || `Request failed (${res.status}).`);
  }
  return json;
}

/** Ask Claude to compare the trainer's authored program to the app program. */
export function compareProgram(programId: string, payload: ComparePayload) {
  return authedJson<CompareResult>("/api/compare-program", {
    programId,
    ...payload,
  });
}

/** Apply accepted suggestions to a draft program via the SECURITY DEFINER RPC. */
export async function applyProgramChanges(
  programId: string,
  changes: CompareSuggestion[],
): Promise<{ applied: number; new_version: number }> {
  const { data, error } = await supabase.rpc("apply_program_changes", {
    p_program_id: programId,
    p_changes: changes,
  });
  if (error) throw new Error(error.message);
  return data as { applied: number; new_version: number };
}

/**
 * Download the program as a branded .docx or .pdf. Returns the Blob and
 * triggers a browser download.
 */
export async function exportProgram(
  programId: string,
  format: ExportFormat,
): Promise<Blob> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated.");

  const res = await fetch("/api/export-program", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ programId, format }),
  });

  if (!res.ok) {
    let message = `Export failed (${res.status}).`;
    try {
      const json = (await res.json()) as { error?: string };
      if (json.error) message = json.error;
    } catch {
      // non-JSON error body; keep the default message
    }
    throw new Error(message);
  }

  const blob = await res.blob();

  // Derive a filename from the Content-Disposition header when present.
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] ?? `program.${format}`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  return blob;
}
