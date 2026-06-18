import { Route, Switch, Redirect } from "wouter";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { RequireRole } from "@/components/auth/RequireRole";
import { AppShell } from "@/components/layout/AppShell";
import { LoginPage } from "@/pages/LoginPage";
import { AcceptInvitePage } from "@/pages/AcceptInvitePage";
import { LandingRedirect } from "@/pages/LandingRedirect";
import { UsersPage } from "@/pages/admin/UsersPage";
import { ProgramsPage } from "@/pages/trainer/ProgramsPage";
import { LearningPage } from "@/pages/trainee/LearningPage";

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
        <Route path="/trainer/programs">
          <RequireRole roles={["admin", "trainer"]}>
            <AppShell>
              <ProgramsPage />
            </AppShell>
          </RequireRole>
        </Route>

        {/* Trainee learning */}
        <Route path="/trainee/learning">
          <RequireRole roles={["trainee"]}>
            <AppShell>
              <LearningPage />
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
