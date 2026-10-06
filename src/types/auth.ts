export type AppRole = "ADMIN" | "GERENTE" | "CAIXA" | "ESTOQUE";

export type Profile = {
  id: string;
  display_name: string;
  role: AppRole;
  is_active: boolean;
  mfa_required: boolean;
};

export type AuthStatus =
  | "loading"
  | "guest"
  | "authenticated"
  | "unassigned"
  | "inactive"
  | "mfa_required"
  | "config_error"
  | "error";
