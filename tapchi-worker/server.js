import "dotenv/config";
import { createServer } from "node:http";
import worker from "./src/index.js";

const port = Number(process.env.PORT || 10000);
const maxBodyBytes = 65_536;
const rateLimiter = createRateLimiter(
  Number(process.env.AI_RATE_LIMIT_MAX || 30),
  Number(process.env.AI_RATE_LIMIT_WINDOW_MS || 60_000)
);

validateEnvironment();

const server = createServer(async (incoming, outgoing) => {
  try {
    const host = incoming.headers.host || `localhost:${port}`;
    const protocol = incoming.headers["x-forwarded-proto"] || "http";
    const url = `${protocol}://${host}${incoming.url || "/"}`;
    const method = incoming.method || "GET";
    const hasBody = method !== "GET" && method !== "HEAD";

    const contentLength = Number(incoming.headers["content-length"] || 0);
    if (contentLength > maxBodyBytes) {
      outgoing.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
      outgoing.end(JSON.stringify({ error: "Request too large" }));
      return;
    }

    const body = hasBody ? await readBody(incoming, maxBodyBytes) : undefined;
    const request = new Request(url, {
      method,
      headers: incoming.headers,
      body
    });

    const env = { ...process.env, AI_RATE_LIMITER: rateLimiter };
    const response = await worker.fetch(request, env, {});
    outgoing.statusCode = response.status;
    response.headers.forEach((value, key) => outgoing.setHeader(key, value));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error("Unhandled request error", error);
    if (!outgoing.headersSent) {
      outgoing.writeHead(error.statusCode || 500, { "Content-Type": "application/json; charset=utf-8" });
    }
    outgoing.end(JSON.stringify({ error: error.statusCode === 413 ? "Request too large" : "Internal server error" }));
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`TapChi API listening on port ${port}`);
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(() => process.exit(0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

async function readBody(stream, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error("Request body exceeds limit");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function createRateLimiter(max, windowMs) {
  const requests = new Map();
  return {
    async limit({ key }) {
      const now = Date.now();
      const current = requests.get(key);
      if (!current || current.resetAt <= now) {
        requests.set(key, { count: 1, resetAt: now + windowMs });
        return { success: true };
      }
      current.count += 1;
      if (requests.size > 10_000) {
        for (const [storedKey, value] of requests) {
          if (value.resetAt <= now) requests.delete(storedKey);
        }
      }
      return { success: current.count <= max };
    }
  };
}

function validateEnvironment() {
  const required = [
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "OPENAI_API_KEY",
    "ALLOWED_ORIGINS"
  ];
  const missing = required.filter(name => !process.env[name]?.trim());
  if (missing.length) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    console.error("PORT must be a valid TCP port");
    process.exit(1);
  }
}
