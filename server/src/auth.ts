import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "./config.js";

export const SESSION_COOKIE = "albums_session";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export function isAuthEnabled() {
  return config.appPassword.length > 0;
}

function sessionSigningKey() {
  return crypto.createHash("sha256").update(`${config.appPassword}:albums-session-v1`).digest();
}

export function verifyPassword(password: string) {
  if (!isAuthEnabled()) return true;
  const expected = Buffer.from(config.appPassword);
  const given = Buffer.from(password);
  if (expected.length !== given.length) {
    crypto.timingSafeEqual(expected, expected);
    return false;
  }
  return crypto.timingSafeEqual(expected, given);
}

export function createSessionToken() {
  const payload = JSON.stringify({
    exp: Date.now() + SESSION_MS,
    n: crypto.randomBytes(12).toString("hex"),
  });
  const body = Buffer.from(payload).toString("base64url");
  const sig = crypto.createHmac("sha256", sessionSigningKey()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySessionToken(token: string | undefined) {
  if (!isAuthEnabled()) return true;
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac("sha256", sessionSigningKey()).update(body).digest("base64url");
  try {
    if (sig.length !== expected.length) return false;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  } catch {
    return false;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { exp?: number };
    return typeof payload.exp === "number" && payload.exp > Date.now();
  } catch {
    return false;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MS / 1000,
    secure: config.secureCookies,
  };
}

export function isRequestAuthenticated(req: FastifyRequest) {
  return verifySessionToken(req.cookies[SESSION_COOKIE]);
}

const LoginBody = z.object({
  password: z.string(),
});

export async function registerAuth(app: FastifyInstance) {
  await app.register(import("@fastify/cookie"));

  app.get("/api/auth/status", async (req) => ({
    required: isAuthEnabled(),
    authenticated: isRequestAuthenticated(req),
  }));

  app.post("/api/auth/login", async (req, reply) => {
    if (!isAuthEnabled()) {
      return { ok: true };
    }
    const b = LoginBody.safeParse(req.body);
    if (!b.success) return reply.status(400).send(b.error.flatten());
    if (!verifyPassword(b.data.password)) {
      return reply.status(401).send({ error: "Incorrect password" });
    }
    reply.setCookie(SESSION_COOKIE, createSessionToken(), sessionCookieOptions());
    return { ok: true };
  });

  app.post("/api/auth/logout", async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.addHook("onRequest", async (req, reply) => {
    if (!isAuthEnabled()) return;
    const path = req.url.split("?")[0] ?? req.url;
    if (path === "/api/auth/login" || path === "/api/auth/status") return;
    if (!path.startsWith("/api/")) return;
    if (isRequestAuthenticated(req)) return;
    return reply.status(401).send({ error: "Authentication required" });
  });
}

export function clearSession(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}
