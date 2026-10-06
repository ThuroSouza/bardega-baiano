import { createContext } from "react";
import type { User } from "@supabase/supabase-js";
import type { AuthStatus, Profile } from "../types/auth";
import type { Permission } from "../config/permissions";

export type AuthState = {
  status: AuthStatus;
  user: User | null;
  profile: Profile | null;
  permissions: Permission[];
};

export type AuthContextValue = AuthState & {
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
