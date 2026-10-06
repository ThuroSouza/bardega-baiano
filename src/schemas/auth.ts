import { z } from "zod";

export const loginSchema = z.object({
  email: z.email("Informe um e-mail válido."),
  password: z.string().min(1, "Informe a senha."),
});

export const recoverSchema = z.object({
  email: z.email("Informe um e-mail válido."),
});

export const resetPasswordSchema = z
  .object({
    password: z.string().min(12, "Use pelo menos 12 caracteres."),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "As senhas não coincidem.",
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Informe a senha atual."),
    password: z.string().min(12, "Use pelo menos 12 caracteres."),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "As senhas não coincidem.",
  });

export const profileSchema = z.object({
  id: z.uuid(),
  display_name: z.string(),
  role: z.enum(["ADMIN", "GERENTE", "CAIXA", "ESTOQUE"]),
  is_active: z.boolean(),
  mfa_required: z.boolean(),
});

export type LoginValues = z.infer<typeof loginSchema>;
export type RecoverValues = z.infer<typeof recoverSchema>;
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;
