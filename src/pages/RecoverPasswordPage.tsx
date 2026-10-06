import { useState } from "react";
import { Link } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Wine } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { requireSupabase, supabaseConfigured } from "../lib/supabase";
import { recoverSchema } from "../schemas/auth";
import type { RecoverValues } from "../schemas/auth";

export default function RecoverPasswordPage() {
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RecoverValues>({ resolver: zodResolver(recoverSchema) });
  const onSubmit = handleSubmit(async ({ email }) => {
    try {
      const client = requireSupabase();
      await client.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/redefinir-senha`,
      });
      // Resposta uniforme para não revelar se o endereço tem cadastro.
      setSent(true);
    } catch {
      setSent(true);
    }
  });

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
          <div className="eyebrow">RECUPERAÇÃO DE ACESSO</div>
          <h1>Esqueceu sua senha?</h1>
          {sent ? (
            <p>
              Se o e-mail estiver cadastrado, você receberá um link para
              redefinir a senha.
            </p>
          ) : (
            <>
              <p>Informe seu e-mail para receber as instruções.</p>
              <form onSubmit={onSubmit}>
                <Input
                  label="E-mail"
                  type="email"
                  autoComplete="email"
                  error={errors.email?.message}
                  {...register("email")}
                />
                <Button
                  type="submit"
                  disabled={isSubmitting || !supabaseConfigured}
                  className="full-width"
                >
                  {isSubmitting ? "Enviando..." : "Enviar link"}
                </Button>
              </form>
            </>
          )}
          {!supabaseConfigured && (
            <p className="auth-warning">Supabase ainda não configurado.</p>
          )}
          <Link to="/login" className="demo-access">
            Voltar ao login
          </Link>
        </Card>
      </div>
    </main>
  );
}
