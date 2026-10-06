import { Link } from "react-router";
import { Button } from "../components/ui/Button";
import { useAuth } from "../hooks/useAuth";
import { homeForRole } from "../config/permissions";

export default function NotFoundPage() {
  const { profile, permissions } = useAuth();
  return (
    <main className="not-found">
      <span className="eyebrow">ERRO 404</span>
      <h1>Página não encontrada</h1>
      <p>O endereço informado não corresponde a uma página do sistema.</p>
      <Button asChild>
        <Link to={profile ? homeForRole(permissions) : "/"}>Voltar ao início</Link>
      </Button>
    </main>
  );
}
