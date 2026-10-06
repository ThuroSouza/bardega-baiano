import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useAuth } from "../../hooks/useAuth";
import { can, homeForRole } from "../../config/permissions";
import type { Permission } from "../../config/permissions";
import { LoadingState, ErrorState } from "../ui/Feedback";

export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === "loading")
    return <LoadingState label="Verificando acesso..." />;
  if (auth.status === "config_error")
    return (
      <ErrorState message="Configure o Supabase para acessar o sistema." />
    );
  if (auth.status === "error")
    return (
      <ErrorState
        message="Não foi possível validar a sessão."
        onRetry={() => void auth.refresh()}
      />
    );
  if (auth.status === "guest")
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (auth.status !== "authenticated")
    return <Navigate to="/acesso-negado" replace />;
  return children;
}

export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const { profile, permissions } = useAuth();
  if (!profile || !can(permissions, permission))
    return <Navigate to="/acesso-negado" replace />;
  return children;
}

export function HomeRedirect() {
  const { profile, permissions } = useAuth();
  return (
    <Navigate to={profile ? homeForRole(permissions) : "/login"} replace />
  );
}
