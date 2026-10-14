import { createMiddleware } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";

/**
 * Auth untuk server functions.
 *
 * Alur:
 *  1. verifyPin (lock.functions.ts) memeriksa PIN, lalu mengeluarkan token bertanda tangan
 *     (HMAC-SHA256) yang kedaluwarsa dalam 12 jam.
 *  2. Token disimpan di sessionStorage browser.
 *  3. `authMiddleware` (client) otomatis menempelkan token ke setiap panggilan server function.
 *  4. `authMiddleware` (server) menolak panggilan tanpa token yang valid.
 *
 * Tidak ada secret baru: kunci tanda tangan diturunkan dari APP_LOCK_PIN yang sudah ada.
 */

export const AUTH_TOKEN_KEY = "app_auth_token_v1";

const TOKEN_VERSION = "v1";
const TOKEN_TTL_SECONDS = 12 * 60 * 60;
const encoder = new TextEncoder();

export class UnauthorizedError extends Error {
  statusCode = 401;
  constructor() {
    super("UNAUTHORIZED: sesi tidak valid atau sudah habis. Masukkan PIN lagi.");
    this.name = "UnauthorizedError";
  }
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sign(payload: string, pin: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`rhcryptanalyzer-lock-v1:${pin}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Dipanggil dari server (verifyPin) setelah PIN terbukti benar. */
export async function issueToken(pin: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = `${TOKEN_VERSION}.${exp}`;
  return `${payload}.${await sign(payload, pin)}`;
}

async function isValidToken(token: string, pin: string | undefined): Promise<boolean> {
  if (!token || !pin) return false; // fail closed: tanpa PIN di server, semuanya ditolak
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = await sign(`${parts[0]}.${parts[1]}`, pin);
  return safeEqual(expected, parts[2]);
}

export const authMiddleware = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    let token: string | null = null;
    try {
      token = sessionStorage.getItem(AUTH_TOKEN_KEY);
    } catch {
      // sessionStorage tidak tersedia: kirim tanpa token, server akan menolak
    }
    try {
      return await next({
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
    } catch (e) {
      // Sesi habis di tengah pemakaian: hapus token dan kembali ke layar PIN.
      if (e instanceof Error && e.message.startsWith("UNAUTHORIZED")) {
        try {
          sessionStorage.removeItem(AUTH_TOKEN_KEY);
        } catch {
          // ignore
        }
        window.location.reload();
      }
      throw e;
    }
  })
  .server(async ({ next }) => {
    const header = getRequestHeader("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!(await isValidToken(token, process.env.APP_LOCK_PIN))) {
      throw new UnauthorizedError();
    }
    return next();
  });
