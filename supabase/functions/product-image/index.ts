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
const inputSchema = z.object({
  product_id: z.uuid(),
  action: z.enum(["upload", "remove"]),
});
const maxFileSize = 3 * 1024 * 1024;
const maxRequestSize = maxFileSize + 256 * 1024;

async function readLimited(request: Request, limit: number): Promise<Uint8Array | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
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
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function validImage(bytes: Uint8Array, type: string): boolean {
  if (type === "image/jpeg") {
    return bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 &&
      bytes[2] === 0xff && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  }
  if (type === "image/png") {
    const header = [137, 80, 78, 71, 13, 10, 26, 10];
    const end = [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130];
    return bytes.length > 20 && header.every((value, i) => bytes[i] === value) &&
      end.every((value, i) => bytes[bytes.length - end.length + i] === value);
  }
  if (type === "image/webp") {
    if (bytes.length < 20) return false;
    const text = new TextDecoder("ascii");
    const riffSize = new DataView(bytes.buffer).getUint32(4, true);
    return text.decode(bytes.slice(0, 4)) === "RIFF" &&
      text.decode(bytes.slice(8, 12)) === "WEBP" && riffSize + 8 === bytes.length &&
      ["VP8 ", "VP8L", "VP8X"].includes(text.decode(bytes.slice(12, 16)));
  }
  return false;
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
  const respond = (status: number, error: string) =>
    new Response(JSON.stringify({ error }), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  if (!allowedOrigins.has(origin)) return respond(403, "origin_denied");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return respond(405, "method_not_allowed");
  if (!projectUrl || !publishableKey || !serviceKey) return respond(503, "function_not_configured");
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return respond(401, "login_required");
  const caller = createClient(projectUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: identity, error: identityError } = await caller.auth.getUser(authorization.slice(7));
  if (identityError || !identity.user) return respond(401, "login_required");
  const { data: permissions, error: permissionError } = await caller.rpc("get_my_permissions");
  if (permissionError || !permissions?.includes("products.manage")) return respond(403, "products_permission_denied");

  const contentType = request.headers.get("content-type") ?? "";
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (!contentType.startsWith("multipart/form-data;") || contentLength > maxRequestSize)
    return respond(413, "image_invalid_file");
  const requestBytes = await readLimited(request, maxRequestSize);
  if (!requestBytes) return respond(413, "image_invalid_file");
  let form: FormData;
  try {
    form = await new Request(request.url, {
      method: "POST", headers: { "Content-Type": contentType }, body: requestBytes,
    }).formData();
  } catch {
    return respond(400, "image_invalid_file");
  }
  const parsed = inputSchema.safeParse({
    product_id: form.get("product_id"), action: form.get("action"),
  });
  if (!parsed.success) return respond(400, "image_invalid_input");
  const { product_id: productId, action } = parsed.data;
  const { data: product, error: productError } = await caller.from("products")
    .select("id,image_path").eq("id", productId).maybeSingle();
  if (productError || !product) return respond(404, "image_product_not_found");

  const admin = createClient(projectUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const storage = admin.storage.from("product-images");
  let nextPath: string | null = null;
  if (action === "upload") {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0 || file.size > maxFileSize)
      return respond(400, "image_invalid_file");
    const extensions: Record<string, string> = {
      "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
    };
    const extension = extensions[file.type];
    if (!extension) return respond(400, "image_invalid_file");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!validImage(bytes, file.type)) return respond(400, "image_invalid_file");
    nextPath = `products/${productId}/${crypto.randomUUID()}.${extension}`;
    const uploaded = await storage.upload(nextPath, bytes, {
      contentType: file.type, upsert: false, cacheControl: "3600",
    });
    if (uploaded.error) {
      console.error("product_image_upload_failed", uploaded.error.statusCode);
      return respond(500, "image_save_failed");
    }
  }
  // A coluna é fechada ao cliente; a função grava atualização e auditoria juntas.
  const { error: updateError } = await admin.rpc("set_product_image_path", {
    p_product_id: productId,
    p_expected_path: product.image_path,
    p_new_path: nextPath,
    p_actor_id: identity.user.id,
  });
  if (updateError) {
    if (nextPath) await storage.remove([nextPath]);
    if (updateError.message === "image_product_changed")
      return respond(409, "image_product_changed");
    if (updateError.message === "image_product_not_found")
      return respond(404, "image_product_not_found");
    console.error("product_image_update_failed", updateError.code);
    return respond(500, "image_save_failed");
  }
  if (product.image_path) {
    const removed = await storage.remove([product.image_path]);
    if (removed.error) console.error("product_image_cleanup_failed", removed.error.statusCode);
  }
  return new Response(JSON.stringify({ image_path: nextPath }), {
    status: 200, headers: { ...cors, "Content-Type": "application/json" },
  });
});
