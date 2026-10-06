import { NavLink } from "react-router";

const links = [
  ["Visão geral", "/financeiro"], ["Resultado", "/financeiro/resultado"], ["Receitas", "/financeiro/receitas"],
  ["Despesas", "/financeiro/despesas"], ["Contas a pagar", "/financeiro/contas-pagar"],
  ["Contas a receber", "/financeiro/contas-receber"],
] as const;

export function FinanceNav() {
  return <nav className="finance-nav" aria-label="Seções do financeiro">{links.map(([label, path]) =>
    <NavLink key={path} to={path} end className={({ isActive }) => isActive ? "active" : ""}>{label}</NavLink>
  )}</nav>;
}
