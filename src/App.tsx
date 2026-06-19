import { Route, Switch, Redirect } from "wouter";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { RequireRole } from "@/components/auth/RequireRole";
import { AppShell } from "@/components/layout/AppShell";
import { LoginPage } from "@/pages/LoginPage";
import { AcceptInvitePage } from "@/pages/AcceptInvitePage";
import { LandingRedirect } from "@/pages/LandingRedirect";
import { UsersPage } from "@/pages/admin/UsersPage";
import { ProgramsPage } from "@/pages/trainer/ProgramsPage";
import { IntakePage } from "@/pages/trainer/IntakePage";
import { ProgramDetailPage } from "@/pages/trainer/ProgramDetailPage";
import { ReportsPage } from "@/pages/trainer/ReportsPage";
import { LearningPage } from "@/pages/trainee/LearningPage";
import { LearningRuntimePage } from "@/pages/trainee/LearningRuntimePage";
import { ProgressPage } from "@/pages/trainee/ProgressPage";

export default function App() {
  return (
    <AuthProvider>
      <Switch>
        {/* Public */}
        <Route path="/login" component={LoginPage} />
        <Route path="/accept-invite" component={AcceptInvitePage} />

        {/* Role-aware landing */}
        <Route path="/">
          <RequireRole>
            <LandingRedirect />
          </RequireRole>
        </Route>

        {/* Trainer console (admins + trainers) */}
        <Route path="/trainer/intake">
          <RequireRole roles={["admin", "trainer"]}>
            <AppShell>
              <IntakePage />
            </AppShell>
          </RequireRole>
        </Route>

        <Route path="/trainer/programs/:programId">
          <RequireRole roles={["admin", "trainer"]}>
            <AppShell>
              <ProgramDetailPage />
            </AppShell>
          </RequireRole>
        </Route>

        <Route path="/trainer/programs">
          <RequireRole roles={["admin", "trainer"]}>
            <AppShell>
              <ProgramsPage />
            </AppShell>
          </RequireRole>
        </Route>

        <Route path="/trainer/reports">
          <RequireRole roles={["admin", "trainer"]}>
            <AppShell>
              <ReportsPage />
            </AppShell>
          </RequireRole>
        </Route>

        {/* Trainee learning */}
        <Route path="/trainee/learning/:programId">
          <RequireRole roles={["trainee"]}>
            <AppShell>
              <LearningRuntimePage />
            </AppShell>
          </RequireRole>
        </Route>

        <Route path="/trainee/learning">
          <RequireRole roles={["trainee"]}>
            <AppShell>
              <LearningPage />
            </AppShell>
          </RequireRole>
        </Route>

        <Route path="/trainee/progress">
          <RequireRole roles={["trainee"]}>
            <AppShell>
              <ProgressPage />
            </AppShell>
          </RequireRole>
        </Route>

        {/* Admin */}
        <Route path="/admin/users">
          <RequireRole roles={["admin"]}>
            <AppShell>
              <UsersPage />
            </AppShell>
          </RequireRole>
        </Route>

        {/* Fallback */}
        <Route>
          <Redirect to="/" />
        </Route>
      </Switch>
    </AuthProvider>
  );
}
