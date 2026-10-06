import { useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { ChevronRight, KeyRound, LogOut, Menu, Wine } from "lucide-react";
import { toast } from "sonner";
import { navigation, sectionLabels } from "../config/navigation";
import { can, homeForRole } from "../config/permissions";
import { useAuth } from "../hooks/useAuth";
import { Drawer } from "../components/ui/Drawer";
import type { Permission } from "../config/permissions";

function Brand({ home }: { home: string }) {
  return (
    <Link to={home} className="brand" aria-label="Bardega do Baiano — início">
      <span className="brand-mark">
        <Wine size={22} strokeWidth={1.8} />
      </span>
      <span className="brand-copy">
        <strong>BARDEGA</strong>
        <small>DO BAIANO</small>
      </span>
    </Link>
  );
}

function NavigationLinks({
  permissions,
  onNavigate,
}: {
  permissions: Permission[];
  onNavigate?: () => void;
}) {
  const allowed = navigation.filter((item) =>
    can(permissions, item.permission),
  );
  return (
    <nav aria-label="Navegação principal">
      {(["principal", "gestao", "sistema"] as const).map((section) => {
        const items = allowed.filter((item) => item.section === section);
        if (!items.length) return null;
        return (
          <div className="nav-section" key={section}>
            <p className="nav-section-label">{sectionLabels[section]}</p>
            {items.map(({ label, path, icon: Icon }) => (
              <NavLink
                key={path}
                to={path}
                onClick={onNavigate}
                className={({ isActive }) =>
                  `nav-link ${isActive ? "active" : ""}`
                }
              >
                <Icon size={19} strokeWidth={1.8} />
                <span>{label}</span>
              </NavLink>
            ))}
          </div>
        );
      })}
    </nav>
  );
}

export function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { profile, permissions, user, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  if (!profile) return null;
  const home = homeForRole(permissions);
  const allowed = navigation.filter((item) =>
    can(permissions, item.permission),
  );
  const mobileItems = allowed.slice(0, 4);
  const current = [...navigation]
    .sort((a, b) => b.path.length - a.path.length)
    .find(
      (item) =>
        location.pathname === item.path ||
        location.pathname.startsWith(`${item.path}/`),
    );
  const initials = (profile.display_name || user?.email || "BB")
    .slice(0, 2)
    .toUpperCase();
  const leave = async () => {
    try {
      await signOut();
      navigate("/login", { replace: true });
    } catch {
      toast.error("Não foi possível encerrar a sessão.");
    }
  };
  return (
    <div className="app-shell">
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>
      <aside className="sidebar">
        <Brand home={home} />
        <div className="sidebar-content">
          <NavigationLinks permissions={permissions} />
        </div>
        <div className="sidebar-footer">
          <span className="status-dot" /> {profile.role}
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu-trigger"
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Abrir menu"
            >
              <Menu size={22} />
            </button>
            <div className="breadcrumb">
              <span>Visão geral</span>
              <ChevronRight size={15} />
              <strong>
                {current?.label ??
                  (location.pathname === "/alterar-senha"
                    ? "Alterar senha"
                    : "Página")}
              </strong>
            </div>
          </div>
          <div className="topbar-right">
            <span className="environment-pill">
              <span className="status-dot" /> Conta autorizada
            </span>
            <Link
              to="/alterar-senha"
              className="header-action"
              aria-label="Alterar senha"
            >
              <KeyRound size={18} />
            </Link>
            <button
              type="button"
              className="header-action"
              onClick={() => void leave()}
              aria-label="Sair"
            >
              <LogOut size={18} />
            </button>
            <span
              className="avatar"
              title={profile.display_name || user?.email || "Usuário"}
            >
              {initials}
            </span>
          </div>
        </header>
        <main id="conteudo" className="page-content">
          <Outlet />
        </main>
      </div>
      <nav
        className="bottom-nav"
        aria-label="Navegação rápida"
        style={{
          gridTemplateColumns: `repeat(${mobileItems.length + 1}, 1fr)`,
        }}
      >
        {mobileItems.map(({ label, path, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              `bottom-link ${isActive ? "active" : ""}`
            }
          >
            <Icon size={22} />
            <span>{label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="bottom-link"
        >
          <Menu size={22} />
          <span>Menu</span>
        </button>
      </nav>
      <Drawer title="Menu" open={menuOpen} onOpenChange={setMenuOpen}>
        <Brand home={home} />
        <NavigationLinks
          permissions={permissions}
          onNavigate={() => setMenuOpen(false)}
        />
        <div className="drawer-account">
          <Link to="/alterar-senha" onClick={() => setMenuOpen(false)}>
            <KeyRound size={18} /> Alterar senha
          </Link>
          <button type="button" onClick={() => void leave()}>
            <LogOut size={18} /> Sair
          </button>
        </div>
      </Drawer>
    </div>
  );
}
