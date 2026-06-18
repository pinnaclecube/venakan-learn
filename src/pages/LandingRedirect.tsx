import { Redirect } from "wouter";
import { useAuth } from "@/hooks/use-auth";

/**
 * Role-aware landing for "/". Admins and trainers land on the trainer console;
 * trainees land on "My Learning". Guarded upstream by <RequireRole>.
 */
export function LandingRedirect() {
  const { role } = useAuth();

  if (role === "trainee") return <Redirect to="/trainee/learning" />;
  // admin + trainer
  return <Redirect to="/trainer/programs" />;
}
