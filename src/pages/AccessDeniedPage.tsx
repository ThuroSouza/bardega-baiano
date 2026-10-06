import { useNavigate } from "react-router";
import { toast } from "sonner";
import { ShieldAlert } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { useAuth } from "../hooks/useAuth";

export default function AccessDeniedPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const message =
    auth.status === "unassigned"
      ? "Seu usuário ainda não tem um perfil autorizado."
      : auth.status === "inactive"
        ? "Seu acesso está desativado. Procure um administrador."
        : auth.status === "mfa_required"
          ? "Esta conta exige autenticação multifator. Procure um administrador para concluir a configuração."
          : "Sua função não permite acessar esta página.";
  const leave = async () => {
    try {
      await auth.signOut();
      navigate("/login", { replace: true });
    } catch {
      toast.error("Não foi possível encerrar a sessão.");
    }
  };
  return (
    <main className="login-page">
      <div className="login-wrap">
        <Card className="login-card denied-card">
          <ShieldAlert size={32} />
          <div className="eyebrow">ACESSO RESTRITO</div>
          <h1>Acesso não permitido</h1>
          <p>{message}</p>
          <Button onClick={() => void leave()} className="full-width">
            Sair da conta
          </Button>
        </Card>
      </div>
    </main>
  );
}
