import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { z } from "npm:zod@4.6.5";

const projectUrl = Deno.env.get("SUPABASE_URL") ?? "";
const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const allowedOrigins = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  ...(Deno.env.get("APP_ORIGIN") ? [Deno.env.get("APP_ORIGIN")!] : []),
]);
const inviteSchema = z.object({
  email: z.string().trim().pipe(z.email().max(254)).transform((value) => value.toLowerCase()),
  display_name: z.string().trim().min(2).max(120),
  role: z.enum(["ADMIN", "GERENTE", "CAIXA", "ESTOQUE"]),
});
const maxRequestSize = 4096;

async function readLimited(request: Request): Promise<string | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxRequestSize) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") ?? "";
  const cors = {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  };
  const respond = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (!allowedOrigins.has(origin)) return respond(403, { error: "origin_denied" });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return respond(405, { error: "method_not_allowed" });
  if (!projectUrl || !publishableKey || !serviceKey) return respond(503, { error: "function_not_configured" });

  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return respond(401, { error: "login_required" });
  const token = authorization.slice(7);
  const caller = createClient(projectUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: identity, error: identityError } = await caller.auth.getUser(token);
  if (identityError || !identity.user) return respond(401, { error: "login_required" });
  const { data: allowed, error: accessError } = await caller.rpc("admin_check_access");
  if (accessError || !allowed) return respond(403, { error: "users_permission_denied" });
  const { data: slot, error: slotError } = await caller.rpc("admin_claim_invite_slot");
  if (slotError) return respond(503, { error: "invite_unavailable" });
  if (!slot) return respond(429, { error: "invite_rate_limited" });

  let input: unknown;
  const body = await readLimited(request);
  if (!body) return respond(413, { error: "users_invalid_input" });
  try { input = JSON.parse(body); } catch { return respond(400, { error: "users_invalid_input" }); }
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return respond(400, { error: "users_invalid_input" });
  const { email, display_name: displayName, role } = parsed.data;

  const admin = createClient(projectUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: invitation, error: invitationError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: displayName },
    redirectTo: `${origin}/redefinir-senha`,
  });
  if (invitationError || !invitation.user) {
    console.error("invite_user_failed", invitationError?.status, invitationError?.code);
    return respond(422, { error: "invite_failed" });
  }
  const { error: profileError } = await caller.rpc("admin_update_user", {
    p_user_id: invitation.user.id,
    p_display_name: displayName,
    p_role: role,
    p_is_active: false,
  });
  if (profileError) {
    console.error("invite_profile_failed", profileError.code);
    return respond(500, { error: "invite_created_profile_update_failed" });
  }
  return respond(201, { id: invitation.user.id });
});
