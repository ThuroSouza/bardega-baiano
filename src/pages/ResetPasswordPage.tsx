import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { LoadingState } from "../components/ui/Feedback";
import { useAuth } from "../hooks/useAuth";
import { requireSupabase } from "../lib/supabase";
import { resetPasswordSchema } from "../schemas/auth";
import type { ResetPasswordValues } from "../schemas/auth";

export default function ResetPasswordPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
  });
  const onSubmit = handleSubmit(async ({ password }) => {
    setFormError("");
    const { error } = await requireSupabase().auth.updateUser({ password });
    if (error) {
      setFormError(
        "Não foi possível atualizar a senha. Solicite um novo link.",
      );
      return;
    }
    toast.success("Senha atualizada.");
    await auth.refresh();
    navigate("/", { replace: true });
  });
  if (auth.status === "loading")
    return <LoadingState label="Validando link..." />;
  return (
    <main className="login-page">
      <div className="login-wrap">
        <Card className="login-card">
          <div className="eyebrow">REDEFINIR SENHA</div>
          <h1>Crie uma nova senha.</h1>
          {auth.user ? (
            <>
              <p>Use pelo menos 12 caracteres.</p>
              <form onSubmit={onSubmit}>
                <Input
                  label="Nova senha"
                  type="password"
                  autoComplete="new-password"
                  error={errors.password?.message}
                  {...register("password")}
                />
                <Input
                  label="Confirmar senha"
                  type="password"
                  autoComplete="new-password"
                  error={errors.confirmPassword?.message}
                  {...register("confirmPassword")}
                />
                {formError && (
                  <p className="auth-error" role="alert">
                    {formError}
                  </p>
                )}
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="full-width"
                >
                  {isSubmitting ? "Salvando..." : "Salvar nova senha"}
                </Button>
              </form>
            </>
          ) : (
            <>
              <p>
                Este link expirou ou é inválido. Solicite outro link de
                recuperação.
              </p>
              <Link to="/recuperar-senha" className="demo-access">
                Solicitar novo link
              </Link>
            </>
          )}
        </Card>
      </div>
    </main>
  );
}
