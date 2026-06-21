import { useState } from "react";
import { Loader2, Upload, FileText, Check, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import {
  compareProgram,
  applyProgramChanges,
  type CompareResult,
  type CompareSuggestion,
} from "@/lib/program-tools";
import { GATE_TYPE_LABELS, type GateType } from "@/lib/generation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface CompareDialogProps {
  programId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied: () => void;
}

type Mode = "upload" | "text";

const OP_LABELS: Record<CompareSuggestion["op"], string> = {
  modify_module: "Modify module",
  add_module: "Add module",
  remove_module: "Remove module",
  modify_exercise: "Modify exercise",
};

export function CompareDialog({
  programId,
  open,
  onOpenChange,
  onApplied,
}: CompareDialogProps) {
  const { profile } = useAuth();
  const [mode, setMode] = useState<Mode>("upload");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [comparing, setComparing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [result, setResult] = useState<CompareResult | null>(null);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});

  function reset() {
    setMode("upload");
    setText("");
    setFile(null);
    setComparing(false);
    setApplying(false);
    setError(null);
    setResult(null);
    setAccepted({});
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function onCompare() {
    setError(null);
    setComparing(true);
    try {
      let res: CompareResult;
      if (mode === "upload") {
        if (!file) throw new Error("Choose a .docx or .pdf file.");
        if (!profile) throw new Error("Not authenticated.");
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
        if (ext !== "docx" && ext !== "pdf") {
          throw new Error("Only .docx or .pdf files are supported.");
        }
        const path = `${profile.tenant_id}/compare/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("jd-uploads")
          .upload(path, file, { upsert: false });
        if (upErr) throw new Error(upErr.message);
        res = await compareProgram(programId, { mode: "upload", storagePath: path });
      } else {
        const clean = text.trim();
        if (!clean) throw new Error("Paste your authored program first.");
        res = await compareProgram(programId, { mode: "text", text: clean });
      }
      setResult(res);
      // Default every suggestion to accepted.
      const next: Record<string, boolean> = {};
      for (const s of res.suggestions) next[s.id] = true;
      setAccepted(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Comparison failed.");
    } finally {
      setComparing(false);
    }
  }

  async function onApply() {
    if (!result) return;
    const changes = result.suggestions.filter((s) => accepted[s.id]);
    if (changes.length === 0) {
      setError("Accept at least one suggestion to apply.");
      return;
    }
    setApplying(true);
    setError(null);
    try {
      await applyProgramChanges(programId, changes);
      handleOpenChange(false);
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Apply failed.");
    } finally {
      setApplying(false);
    }
  }

  const acceptedCount = result
    ? result.suggestions.filter((s) => accepted[s.id]).length
    : 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Compare with my version</DialogTitle>
          <DialogDescription>
            Upload or paste your own authored program. We compare it to the
            app-generated draft and suggest concrete changes.
          </DialogDescription>
        </DialogHeader>

        {!result && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={mode === "upload" ? "default" : "outline"}
                onClick={() => setMode("upload")}
              >
                <Upload className="h-4 w-4" /> Upload
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === "text" ? "default" : "outline"}
                onClick={() => setMode("text")}
              >
                <FileText className="h-4 w-4" /> Paste text
              </Button>
            </div>

            {mode === "upload" ? (
              <div className="space-y-1.5">
                <Label htmlFor="compare-file">Your program (.docx or .pdf)</Label>
                <input
                  id="compare-file"
                  type="file"
                  accept=".docx,.pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-mist file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink"
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="compare-text">Paste your authored program</Label>
                <Textarea
                  id="compare-text"
                  className="min-h-40"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Paste the full text of your own training program…"
                />
              </div>
            )}
          </div>
        )}

        {comparing && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-emerald-strong" />
            Comparing…
          </div>
        )}

        {result && (
          <div className="space-y-4">
            <div className="rounded-md border border-emerald/40 bg-mist p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Summary
              </p>
              <p className="mt-1 text-sm text-ink">{result.summary}</p>
            </div>

            {result.suggestions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No changes suggested — the draft already aligns with your version.
              </p>
            ) : (
              <div className="space-y-2">
                {result.suggestions.map((s) => {
                  const isOn = accepted[s.id] ?? false;
                  return (
                    <div
                      key={s.id}
                      className="rounded-md border border-border p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{OP_LABELS[s.op]}</Badge>
                            {typeof s.target_module_order === "number" && (
                              <span className="text-xs text-muted-foreground">
                                Module {s.target_module_order}
                              </span>
                            )}
                            {s.fields?.gate_type && (
                              <Badge variant="muted">
                                {GATE_TYPE_LABELS[s.fields.gate_type as GateType]}
                              </Badge>
                            )}
                          </div>
                          <p className="mt-1.5 text-sm font-medium text-ink">
                            {s.title}
                          </p>
                          <p className="mt-0.5 text-sm text-muted-foreground">
                            {s.rationale}
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant={isOn ? "default" : "outline"}
                          onClick={() =>
                            setAccepted((prev) => ({ ...prev, [s.id]: !isOn }))
                          }
                        >
                          {isOn ? (
                            <>
                              <Check className="h-4 w-4" /> Accepted
                            </>
                          ) : (
                            <>
                              <X className="h-4 w-4" /> Rejected
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={comparing || applying}
          >
            Cancel
          </Button>
          {!result ? (
            <Button type="button" onClick={onCompare} disabled={comparing}>
              {comparing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Comparing…
                </>
              ) : (
                "Compare"
              )}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={onApply}
              disabled={applying || acceptedCount === 0}
            >
              {applying ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Applying…
                </>
              ) : (
                `Apply ${acceptedCount} accepted change${
                  acceptedCount === 1 ? "" : "s"
                }`
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
