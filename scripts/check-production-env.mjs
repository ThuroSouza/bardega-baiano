import { existsSync, readFileSync } from "node:fs";
import { loadEnv } from "vite";

const root = process.cwd();
const failures = [];

if (existsSync(".env.local")) {
  failures.push("Remova .env.local antes do build de produção; use arquivos específicos por ambiente.");
}
if (!existsSync(".env.production.local") &&
    (!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_PUBLISHABLE_KEY)) {
  failures.push("Configure .env.production.local ou as variáveis VITE_ no ambiente de build.");
}

const production = loadEnv("production", root, "VITE_");
const developmentExample = readFileSync(new URL("../.env.development.example", import.meta.url), "utf8");
const developmentUrl = /^VITE_SUPABASE_URL=(.+)$/m.exec(developmentExample)?.[1];

function projectRef(value, label) {
  try {
    const url = new URL(value);
    const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname);
    if (url.protocol !== "https:" || !match || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("invalid");
    }
    return match[1];
  } catch {
    failures.push(`${label} deve ser uma URL HTTPS válida de projeto Supabase.`);
    return null;
  }
}

const devRef = projectRef(developmentUrl, "URL de desenvolvimento de referência");
const prodRef = projectRef(production.VITE_SUPABASE_URL, "URL de produção");

if (devRef && prodRef && devRef === prodRef) {
  failures.push("Desenvolvimento e produção não podem apontar para o mesmo projeto Supabase.");
}
if (!production.VITE_SUPABASE_PUBLISHABLE_KEY?.startsWith("sb_publishable_") ||
    production.VITE_SUPABASE_PUBLISHABLE_KEY.includes("SUBSTITUA")) {
  failures.push("Defina a chave publicável de produção em .env.production.local.");
}
if (existsSync(".env.development.local") && !process.env.VITE_SUPABASE_PUBLISHABLE_KEY) {
  const development = loadEnv("development", root, "VITE_");
  if (production.VITE_SUPABASE_PUBLISHABLE_KEY === development.VITE_SUPABASE_PUBLISHABLE_KEY) {
    failures.push("As chaves publicáveis de desenvolvimento e produção devem ser diferentes.");
  }
}

if (failures.length) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Ambientes separados: configuração de produção validada.");
}
