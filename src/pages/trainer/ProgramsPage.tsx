import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";

/**
 * PLACEHOLDER (Prompt 1). Course generation / programs are built in a later
 * prompt. This is an empty shell so the shell + routing are navigable.
 */
export function ProgramsPage() {
  return (
    <div>
      <PageHeader
        title="Programs"
        description="Trainer console. Course generation and refinement arrive in a later release."
      />
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Nothing here yet.
        </CardContent>
      </Card>
    </div>
  );
}
