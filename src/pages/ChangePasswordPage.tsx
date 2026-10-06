import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { requireSupabase } from "../lib/supabase";
import { changePasswordSchema } from "../schemas/auth";
import type { ChangePasswordValues } from "../schemas/auth";

export default function ChangePasswordPage() {
  const [formError, setFormError] = useState("");
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
  });
  const onSubmit = handleSubmit(async ({ currentPassword, password }) => {
    setFormError("");
    const { error } = await requireSupabase().auth.updateUser({
      password,
      current_password: currentPassword,
    });
    if (error) {
      setFormError("Não foi possível alterar a senha. Confira a senha atual.");
      return;
    }
    reset();
    toast.success("Senha alterada com sucesso.");
  });
  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <div className="eyebrow">SEGURANÇA DA CONTA</div>
          <h1>Alterar senha</h1>
          <p>Atualize a senha usada para acessar o sistema.</p>
        </div>
      </div>
      <Card className="password-card">
        <form onSubmit={onSubmit}>
          <Input
            label="Senha atual"
            type="password"
            autoComplete="current-password"
            error={errors.currentPassword?.message}
            {...register("currentPassword")}
          />
          <Input
            label="Nova senha"
            type="password"
            autoComplete="new-password"
            error={errors.password?.message}
            {...register("password")}
          />
          <Input
            label="Confirmar nova senha"
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
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Salvando..." : "Alterar senha"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
