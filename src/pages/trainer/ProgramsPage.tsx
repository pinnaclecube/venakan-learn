import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, Plus, Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  generateProgram,
  type Program,
  type RoleDefinition,
} from "@/lib/generation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ProgramsPage() {
  const [, navigate] = useLocation();
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [roleRes, progRes] = await Promise.all([
      supabase
        .from("role_definition")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase
        .from("program")
        .select("*")
        .order("created_at", { ascending: false }),
    ]);
    if (roleRes.error) setError(roleRes.error.message);
    else setRoles((roleRes.data as RoleDefinition[]) ?? []);
    if (progRes.error) setError(progRes.error.message);
    else setPrograms((progRes.data as Program[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onGenerate(roleId: string) {
    setGeneratingId(roleId);
    setError(null);
    try {
      const { programId } = await generateProgram(roleId);
      navigate(`/trainer/programs/${programId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed.");
      setGeneratingId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Programs"
        description="Role definitions and the training programs generated from them."
        actions={
          <Button onClick={() => navigate("/trainer/intake")}>
            <Plus className="h-4 w-4" /> New role intake
          </Button>
        }
      />

      {error && (
        <p className="mb-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-strong" />
        </div>
      ) : roles.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No role definitions yet. Start with a role intake.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {roles.map((role) => {
            const rolePrograms = programs.filter(
              (p) => p.role_definition_id === role.id,
            );
            const busy = generatingId === role.id;
            return (
              <Card key={role.id}>
                <CardHeader className="flex-row items-start justify-between space-y-0">
                  <div>
                    <CardTitle className="text-base">{role.title}</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {role.family || "—"} ·{" "}
                      {new Date(role.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => onGenerate(role.id)} disabled={busy}>
                    {busy ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Generating…
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" /> Generate program
                      </>
                    )}
                  </Button>
                </CardHeader>
                <CardContent>
                  {rolePrograms.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No programs generated yet.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {rolePrograms.map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() =>
                              navigate(`/trainer/programs/${p.id}`)
                            }
                            className="flex w-full items-center justify-between py-2 text-left text-sm hover:text-emerald-strong"
                          >
                            <span>
                              {p.week_count} week
                              {p.week_count === 1 ? "" : "s"} · v{p.version}
                            </span>
                            <Badge
                              variant={
                                p.status === "published" ? "success" : "muted"
                              }
                            >
                              {p.status}
                            </Badge>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
