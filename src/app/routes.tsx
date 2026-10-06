import { lazy, Suspense } from "react";
import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router";
import { AppLayout } from "../layouts/AppLayout";
import { LoadingState } from "../components/ui/Feedback";
import {
  HomeRedirect,
  RequireAuth,
  RequirePermission,
} from "../components/navigation/RouteGuards";
import type { Permission } from "../config/permissions";
const DashboardPage = lazy(() => import("../pages/DashboardPage"));
const LoginPage = lazy(() => import("../pages/LoginPage"));
const RecoverPasswordPage = lazy(() => import("../pages/RecoverPasswordPage"));
const ResetPasswordPage = lazy(() => import("../pages/ResetPasswordPage"));
const ChangePasswordPage = lazy(() => import("../pages/ChangePasswordPage"));
const AccessDeniedPage = lazy(() => import("../pages/AccessDeniedPage"));
const NotFoundPage = lazy(() => import("../pages/NotFoundPage"));
const PdvPage = lazy(() => import("../pages/modules/PdvPage"));
const VendasPage = lazy(() => import("../pages/modules/VendasPage"));
const VendaDetalhePage = lazy(
  () => import("../pages/modules/VendaDetalhePage"),
);
const CaixaPage = lazy(() => import("../pages/modules/CaixaPage"));
const EstoquePage = lazy(() => import("../pages/modules/EstoquePage"));
const ProdutosPage = lazy(() => import("../pages/modules/ProdutosPage"));
const ProdutoDetalhePage = lazy(
  () => import("../pages/modules/ProdutoDetalhePage"),
);
const CategoriasPage = lazy(() => import("../pages/modules/CategoriasPage"));
const FornecedoresPage = lazy(
  () => import("../pages/modules/FornecedoresPage"),
);
const ClientesPage = lazy(() => import("../pages/modules/ClientesPage"));
const FinanceiroPage = lazy(() => import("../pages/modules/FinanceiroPage"));
const ResultadoPage = lazy(() => import("../pages/modules/ResultadoPage"));
const ReceitasPage = lazy(() => import("../pages/modules/ReceitasPage"));
const DespesasPage = lazy(() => import("../pages/modules/DespesasPage"));
const ContasPagarPage = lazy(() => import("../pages/modules/ContasPagarPage"));
const ContasReceberPage = lazy(
  () => import("../pages/modules/ContasReceberPage"),
);
const RelatoriosPage = lazy(() => import("../pages/modules/RelatoriosPage"));
const UsuariosPage = lazy(() => import("../pages/modules/UsuariosPage"));
const AuditoriaPage = lazy(() => import("../pages/modules/AuditoriaPage"));
const IntegracoesPage = lazy(() => import("../pages/modules/IntegracoesPage"));
const ConfiguracoesPage = lazy(
  () => import("../pages/modules/ConfiguracoesPage"),
);

function authorized(permission: Permission, page: ReactNode) {
  return <RequirePermission permission={permission}>{page}</RequirePermission>;
}

export function AppRoutes() {
  return (
    <Suspense fallback={<LoadingState label="Carregando página..." />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/recuperar-senha" element={<RecoverPasswordPage />} />
        <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
        <Route path="/acesso-negado" element={<AccessDeniedPage />} />
        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<HomeRedirect />} />
          <Route
            path="dashboard"
            element={authorized("dashboard.read", <DashboardPage />)}
          />
          <Route path="pdv" element={authorized("pdv.use", <PdvPage />)} />
          <Route
            path="vendas"
            element={authorized("sales.read", <VendasPage />)}
          />
          <Route
            path="vendas/:id"
            element={authorized("sales.read", <VendaDetalhePage />)}
          />
          <Route
            path="caixa"
            element={authorized("cash.manage", <CaixaPage />)}
          />
          <Route
            path="estoque"
            element={authorized("stock.read", <EstoquePage />)}
          />
          <Route
            path="produtos"
            element={authorized("products.read", <ProdutosPage />)}
          />
          <Route
            path="produtos/:id"
            element={authorized("products.read", <ProdutoDetalhePage />)}
          />
          <Route
            path="categorias"
            element={authorized("products.read", <CategoriasPage />)}
          />
          <Route
            path="fornecedores"
            element={authorized("products.read", <FornecedoresPage />)}
          />
          <Route
            path="clientes"
            element={authorized("sales.read", <ClientesPage />)}
          />
          <Route
            path="financeiro"
            element={authorized("finance.read", <FinanceiroPage />)}
          />
          <Route
            path="financeiro/resultado"
            element={authorized("finance.read", <ResultadoPage />)}
          />
          <Route
            path="financeiro/receitas"
            element={authorized("finance.read", <ReceitasPage />)}
          />
          <Route
            path="financeiro/despesas"
            element={authorized("finance.read", <DespesasPage />)}
          />
          <Route
            path="financeiro/contas-pagar"
            element={authorized("finance.read", <ContasPagarPage />)}
          />
          <Route
            path="financeiro/contas-receber"
            element={authorized("finance.read", <ContasReceberPage />)}
          />
          <Route
            path="relatorios"
            element={authorized("reports.read", <RelatoriosPage />)}
          />
          <Route
            path="usuarios"
            element={authorized("users.read", <UsuariosPage />)}
          />
          <Route
            path="auditoria"
            element={authorized("audit.read", <AuditoriaPage />)}
          />
          <Route
            path="integracoes"
            element={authorized("integrations.manage", <IntegracoesPage />)}
          />
          <Route
            path="configuracoes"
            element={authorized("settings.manage", <ConfiguracoesPage />)}
          />
          <Route path="alterar-senha" element={<ChangePasswordPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
