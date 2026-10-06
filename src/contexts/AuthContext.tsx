import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { profileSchema } from "../schemas/auth";
import { supabase, supabaseConfigured } from "../lib/supabase";
import { AuthContext } from "./auth-state";
import type { AuthState } from "./auth-state";
import { permissions as knownPermissions } from "../config/permissions";
import type { Permission } from "../config/permissions";

const initialState: AuthState = {
  status: supabaseConfigured ? "loading" : "config_error",
  user: null,
  profile: null,
  permissions: [],
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(initialState);
  const revision = useRef(0);

  const refresh = useCallback(async () => {
    const current = ++revision.current;
    if (!supabase) {
      setState({ status: "config_error", user: null, profile: null, permissions: [] });
      return;
    }
    setState((previous) => ({ ...previous, status: "loading" }));
    try {
      // getUser consulta Auth e valida a sessão; dados locais não autorizam rotas.
      const { data: authData, error: authError } =
        await supabase.auth.getUser();
      if (current !== revision.current) return;
      if (!authData.user) {
        setState({
          status:
            authError?.name === "AuthSessionMissingError" ? "guest" : "error",
          user: null,
          profile: null,
          permissions: [],
        });
        return;
      }
      const user = authData.user;
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, role, is_active, mfa_required")
        .eq("id", user.id)
        .maybeSingle();
      if (current !== revision.current) return;
      if (error) throw error;
      if (!data) {
        setState({ status: "unassigned", user, profile: null, permissions: [] });
        return;
      }
      const parsed = profileSchema.safeParse(data);
      if (!parsed.success) throw new Error("Perfil inválido.");
      const profile = parsed.data;
      if (!profile.is_active) {
        setState({ status: "inactive", user, profile, permissions: [] });
        return;
      }
      if (profile.mfa_required) {
        const { data: assurance, error: assuranceError } =
          await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (current !== revision.current) return;
        if (assuranceError) throw assuranceError;
        if (assurance.currentLevel !== "aal2") {
          setState({ status: "mfa_required", user, profile, permissions: [] });
          return;
        }
      }
      const { data: granted, error: permissionsError } = await supabase.rpc("get_my_permissions");
      if (current !== revision.current) return;
      if (permissionsError) throw permissionsError;
      const allowed = new Set<string>(knownPermissions);
      setState({ status: "authenticated", user, profile,
        permissions: (granted ?? []).filter((item: string): item is Permission => allowed.has(item)) });
    } catch {
      if (current === revision.current) {
        setState({ status: "error", user: null, profile: null, permissions: [] });
      }
    }
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    revision.current++;
    setState({ status: "guest", user: null, profile: null, permissions: [] });
  }, []);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void refresh(), 0);
    if (!supabase) return () => window.clearTimeout(initialTimer);
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "INITIAL_SESSION") return;
      if (event === "SIGNED_OUT") {
        revision.current++;
        setState({ status: "guest", user: null, profile: null, permissions: [] });
        return;
      }
      window.setTimeout(() => void refresh(), 0);
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    const invalidate = () => { revision.current++; };
    return () => {
      window.clearTimeout(initialTimer);
      invalidate();
      listener.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ ...state, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
