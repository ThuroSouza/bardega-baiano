import type { LucideIcon } from "lucide-react";
import type { Permission } from "./permissions";
import {
  BarChart3,
  Boxes,
  ClipboardList,
  CreditCard,
  LayoutDashboard,
  Package,
  ReceiptText,
  Settings,
  ShoppingBasket,
  Users,
  Wallet,
  Workflow,
} from "lucide-react";

export type NavigationItem = {
  label: string;
  path: string;
  icon: LucideIcon;
  section: "principal" | "gestao" | "sistema";
  permission: Permission;
};

export const navigation: NavigationItem[] = [
  {
    label: "Dashboard",
    path: "/dashboard",
    icon: LayoutDashboard,
    section: "principal",
    permission: "dashboard.read",
  },
  {
    label: "PDV",
    path: "/pdv",
    icon: ShoppingBasket,
    section: "principal",
    permission: "pdv.use",
  },
  {
    label: "Vendas",
    path: "/vendas",
    icon: ReceiptText,
    section: "principal",
    permission: "sales.read",
  },
  {
    label: "Caixa",
    path: "/caixa",
    icon: Wallet,
    section: "principal",
    permission: "cash.manage",
  },
  {
    label: "Estoque",
    path: "/estoque",
    icon: Boxes,
    section: "gestao",
    permission: "stock.read",
  },
  {
    label: "Produtos",
    path: "/produtos",
    icon: Package,
    section: "gestao",
    permission: "products.read",
  },
  {
    label: "Financeiro",
    path: "/financeiro",
    icon: CreditCard,
    section: "gestao",
    permission: "finance.read",
  },
  {
    label: "Relatórios",
    path: "/relatorios",
    icon: BarChart3,
    section: "gestao",
    permission: "reports.read",
  },
  {
    label: "Usuários",
    path: "/usuarios",
    icon: Users,
    section: "sistema",
    permission: "users.read",
  },
  {
    label: "Auditoria",
    path: "/auditoria",
    icon: ClipboardList,
    section: "sistema",
    permission: "audit.read",
  },
  {
    label: "Integrações",
    path: "/integracoes",
    icon: Workflow,
    section: "sistema",
    permission: "integrations.manage",
  },
  {
    label: "Configurações",
    path: "/configuracoes",
    icon: Settings,
    section: "sistema",
    permission: "settings.manage",
  },
];

export const sectionLabels = {
  principal: "Principal",
  gestao: "Gestão",
  sistema: "Sistema",
};
