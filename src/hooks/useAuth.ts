import { useContext } from "react";
import { AuthContext } from "../contexts/auth-state";

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth requer AuthProvider.");
  return context;
}
