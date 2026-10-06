import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Wine } from "lucide-react";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { useAuth } from "../hooks/useAuth";
import { homeForRole } from "../config/permissions";
import { loginSchema } from "../schemas/auth";
import type { LoginValues } from "../schemas/auth";
import { requireSupabase, supabaseConfigured } from "../lib/supabase";
import { toast } from "sonner";

export default function LoginPage() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [formError, setFormError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });
  const onSubmit = handleSubmit(async ({ email, password }) => {
    setFormError("");
    const { error } = await requireSupabase().auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      setFormError("Não foi possível entrar. Confira o e-mail e a senha.");
      return;
    }
    const { error: auditError } = await requireSupabase().rpc("record_login_event");
    if (auditError) toast.error("Login realizado, mas o registro de auditoria não foi concluído.");
    const requested = location.state?.from;
    navigate(
      typeof requested === "string" &&
        requested.startsWith("/") &&
        !requested.startsWith("//")
        ? requested
        : "/",
      { replace: true },
    );
  });
  if (auth.status === "authenticated" && auth.profile)
    return <Navigate to={homeForRole(auth.permissions)} replace />;
  if (["unassigned", "inactive", "mfa_required"].includes(auth.status))
    return <Navigate to="/acesso-negado" replace />;

  return (
    <main className="login-page">
      <div className="login-wrap">
        <div className="login-brand">
          <span className="brand-mark">
            <Wine size={26} />
          </span>
          <strong>
            BARDEGA <span>DO BAIANO</span>
          </strong>
        </div>
        <Card className="login-card">
          <div className="eyebrow">ACESSO AO SISTEMA</div>
          <h1>Boas-vindas de volta.</h1>
          <p>Entre com sua conta autorizada para continuar.</p>
          <form onSubmit={onSubmit}>
            <Input
              label="E-mail"
              type="email"
              autoComplete="email"
              placeholder="seu@email.com"
              error={errors.email?.message}
              {...register("email")}
            />
            <Input
              label="Senha"
              type="password"
              autoComplete="current-password"
              placeholder="Sua senha"
              error={errors.password?.message}
              {...register("password")}
            />
            {formError && (
              <p className="auth-error" role="alert">
                {formError}
              </p>
            )}
            {!supabaseConfigured && (
              <p className="auth-warning" role="alert">
                Configure VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY para
                entrar.
              </p>
            )}
            <Button
              type="submit"
              disabled={isSubmitting || !supabaseConfigured}
              className="full-width"
            >
              {isSubmitting ? "Entrando..." : "Entrar"}
            </Button>
          </form>
          <Link to="/recuperar-senha" className="demo-access">
            Esqueci minha senha
          </Link>
        </Card>
        <p className="login-footnote">Bardega do Baiano · Sistema de gestão</p>
      </div>
    </main>
  );
}
