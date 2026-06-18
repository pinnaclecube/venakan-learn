import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, Upload, FileText } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { parseRole, type CanonicalRole, type SourceType } from "@/lib/generation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RoleReviewPanel } from "@/components/intake/RoleReviewPanel";

type Mode = "prompt" | "jd_upload";

const EMPTY_ROLE: CanonicalRole = {
  title: "",
  role_family: "",
  primary_stack: [],
  responsibilities: [],
  skill_matrix: [],
  milestones: [],
};

export function IntakePage() {
  const { profile } = useAuth();
  const [, navigate] = useLocation();
  const fileRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<Mode>("prompt");
  const [promptText, setPromptText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [role, setRole] = useState<CanonicalRole | null>(null);
  const [sourceType, setSourceType] = useState<SourceType>("prompt");
  const [sourceText, setSourceText] = useState("");

  async function runParse(input: Parameters<typeof parseRole>[0]) {
    setParsing(true);
    setError(null);
    try {
      const { role: parsed, sourceText: src } = await parseRole(input);
      setRole({ ...EMPTY_ROLE, ...parsed });
      setSourceText(src);
      setSourceType(input.mode);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not parse the role.");
    } finally {
      setParsing(false);
    }
  }

  async function onParsePrompt() {
    const text = promptText.trim();
    if (!text) {
      setError("Enter a role brief first.");
      return;
    }
    await runParse({ mode: "prompt", text });
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    setError(null);
    setParsing(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
      const path = `${profile.tenant_id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("jd-uploads")
        .upload(path, file, { upsert: false });
      if (upErr) throw new Error(upErr.message);
      await runParse({ mode: "jd_upload", storagePath: path });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setParsing(false);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onSave() {
    if (!role || !profile) return;
    setSaving(true);
    setError(null);
    try {
      const { error: insErr } = await supabase.from("role_definition").insert({
        tenant_id: profile.tenant_id,
        title: role.title,
        family: role.role_family || null,
        stack: role.primary_stack,
        skill_matrix: role.skill_matrix,
        milestones: role.milestones,
        source_type: sourceType,
        source_text: sourceText || null,
        created_by: profile.id,
      });
      if (insErr) throw new Error(insErr.message);
      navigate("/trainer/programs");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save role.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Role intake"
        description="Turn a job description or a free-text brief into a canonical role definition, then generate a program from it."
      />

      {error && (
        <p className="mb-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {!role && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New role</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Button
                variant={mode === "prompt" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("prompt")}
              >
                <FileText className="h-4 w-4" /> Free-text prompt
              </Button>
              <Button
                variant={mode === "jd_upload" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("jd_upload")}
              >
                <Upload className="h-4 w-4" /> Upload JD
              </Button>
            </div>

            {mode === "prompt" ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="brief">Role brief</Label>
                  <Textarea
                    id="brief"
                    className="min-h-40"
                    value={promptText}
                    onChange={(e) => setPromptText(e.target.value)}
                    placeholder="Describe the role: responsibilities, the stack, the level of autonomy a graduate should reach…"
                    disabled={parsing}
                  />
                </div>
                <Button onClick={onParsePrompt} disabled={parsing}>
                  {parsing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Parsing…
                    </>
                  ) : (
                    "Parse role"
                  )}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Upload a .pdf or .docx job description. It is parsed into the
                  canonical role for review.
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.docx"
                  className="hidden"
                  onChange={onUpload}
                />
                <Button
                  onClick={() => fileRef.current?.click()}
                  disabled={parsing}
                >
                  {parsing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Parsing…
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4" /> Choose file
                    </>
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {role && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Review role definition</CardTitle>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setRole(null);
                  setError(null);
                }}
                disabled={saving}
              >
                Re-parse
              </Button>
              <Button size="sm" onClick={onSave} disabled={saving || !role.title}>
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                  </>
                ) : (
                  "Save role definition"
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <RoleReviewPanel value={role} onChange={setRole} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
