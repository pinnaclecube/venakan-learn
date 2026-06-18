import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";

/**
 * PLACEHOLDER (Prompt 1). The trainee learning experience is built in a later
 * prompt. Empty shell only.
 */
export function LearningPage() {
  return (
    <div>
      <PageHeader
        title="My Learning"
        description="Your assigned programs will appear here once they are published."
      />
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          You have no assigned programs yet.
        </CardContent>
      </Card>
    </div>
  );
}
