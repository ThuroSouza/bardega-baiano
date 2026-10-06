export const permissions = [
  "dashboard.read",
  "pdv.use",
  "sales.discount",
  "sales.cancel",
  "sales.read",
  "cash.manage",
  "cash.view_all",
  "stock.read",
  "stock.manage",
  "products.read",
  "products.manage",
  "finance.read",
  "finance.manage",
  "reports.read",
  "users.read",
  "users.manage",
  "audit.read",
  "integrations.manage",
  "settings.manage",
] as const;

export type Permission = (typeof permissions)[number];

// A interface recebe as permissões efetivas do banco ao validar a sessão.
export function can(granted: readonly Permission[], permission: Permission) {
  return granted.includes(permission);
}

export function homeForRole(granted: readonly Permission[]) {
  if (can(granted, "dashboard.read")) return "/dashboard";
  if (can(granted, "pdv.use")) return "/pdv";
  if (can(granted, "stock.read")) return "/estoque";
  if (can(granted, "products.read")) return "/produtos";
  if (can(granted, "sales.read")) return "/vendas";
  return "/acesso-negado";
}
