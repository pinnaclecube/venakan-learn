import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import {
  refine,
  type DiffPayload,
  type RefinementTargetKind,
} from "@/lib/generation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface RefineTarget {
  kind: RefinementTargetKind;
  id: string;
  label: string;
}

interface RefineDialogProps {
  programId: string;
  target: RefineTarget | null;
  onOpenChange: (open: boolean) => void;
  onRefined: (result: {
    refinementId: string;
    diff: DiffPayload;
    newVersion: number;
  }) => void;
}

export function RefineDialog({
  programId,
  target,
  onOpenChange,
  onRefined,
}: RefineDialogProps) {
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!target) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await refine({
        programId,
        targetKind: target.kind,
        targetId: target.id,
        prompt: prompt.trim(),
      });
      setPrompt("");
      onOpenChange(false);
      onRefined(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refinement failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(next) => {
        if (!next) {
          setPrompt("");
          setError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refine {target?.kind}</DialogTitle>
          <DialogDescription>{target?.label}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="refine-prompt">What should change?</Label>
            <Textarea
              id="refine-prompt"
              className="min-h-28"
              required
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Make the rubric stricter on test coverage; add an exercise on error handling…"
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !prompt.trim()}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Refining…
                </>
              ) : (
                "Refine"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
