import { config as loadEnv } from "dotenv";
import { writeFile } from "node:fs/promises";

loadEnv({ path: ".env.local", quiet: true });

const config = {
  SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  API_URL: process.env.NEXT_PUBLIC_API_URL
};
const missing = Object.entries(config).filter(([, value]) => !value?.trim()).map(([name]) => name);
if (missing.length) throw new Error(`Missing public build variables: ${missing.join(", ")}`);

await writeFile(
  new URL("../config.js", import.meta.url),
  `window.__APP_CONFIG__ = Object.freeze(${JSON.stringify(config, null, 2)});\n`,
  { encoding: "utf8", mode: 0o600 }
);
console.log("Generated public config.js");
