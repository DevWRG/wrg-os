// Gerbang otorisasi API (dipasang di index.ts saat AUTH_ENABLED=true).
//
// Dua jalur masuk:
//   • x-service-token (BFF web tepercaya) — identitas pengguna dikirim BFF lewat
//     header x-user-id / isi body setelah BFF memeriksa sesi & izin menu.
//   • Bearer JWT (hasil /auth/login) — dipakai langsung ke API, mis. dari skrip.
//
// Celah yang ditutup (uji fungsional 12 Nov 2026): dulu JWT apa pun lolos SETARA
// service token, padahal puluhan route mempercayai identitas dari header
// x-user-id atau field body (approver_id, actor, decided_by, created_by, …). AM
// yang login lalu memanggil API langsung (port API terjangkau lewat Tailscale)
// bisa memutus approval / menandai klaim dibayar atas nama HoD atau Finance, dan
// membaca data dengan scope pengguna lain.
//
// Aturan sekarang untuk JWT: hanya role admin yang boleh memanggil API langsung
// (role diambil dari token yang ditandatangani server, bukan dari klien), dan
// x-user-id DIPAKSA = pemilik token. Pengguna lain → 403, pakai dashboard. Jalur
// /auth/* (me, ganti password) tetap dikecualikan dan memverifikasi token sendiri.

import type { Context, Next } from "hono";

import { verifyJwt } from "./auth.js";

export type KeputusanJwt = { ok: true; userId: string } | { ok: false; status: 401 | 403; error: string };

/** Murni: siapa pemilik JWT dan bolehkah ia memanggil API langsung. */
export function nilaiJwt(payload: Record<string, unknown> | null): KeputusanJwt {
  if (!payload) return { ok: false, status: 401, error: "unauthorized" };
  const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
  if (!sub) return { ok: false, status: 401, error: "unauthorized" };
  const role = typeof payload.role === "string" ? payload.role.trim().toLowerCase() : "";
  if (role !== "admin") {
    return { ok: false, status: 403, error: "Akses API langsung hanya untuk admin — gunakan dashboard WRG OS." };
  }
  return { ok: true, userId: sub };
}

export const authExempt = (path: string): boolean =>
  path === "/health" || path.startsWith("/auth/") || path.startsWith("/webhooks/");

/** Middleware Hono. `enabled`/`serviceToken` disuntik supaya bisa diuji tanpa env. */
export function gerbangAuth(opts: { enabled: () => boolean; serviceToken: () => string | undefined }) {
  return async (c: Context, next: Next) => {
    if (!opts.enabled() || authExempt(c.req.path)) return next();
    const svc = opts.serviceToken();
    if (svc && c.req.header("x-service-token") === svc) return next();
    const authz = c.req.header("authorization") ?? "";
    const token = authz.startsWith("Bearer ") ? authz.slice(7) : "";
    const k = nilaiJwt(token ? verifyJwt(token) : null);
    if (!k.ok) return c.json({ error: k.error }, k.status);
    // Identitas dari token, bukan dari klien: timpa x-user-id. Gagal menimpa =
    // tolak (fail-closed), jangan teruskan header palsu.
    try {
      c.req.raw.headers.set("x-user-id", k.userId);
    } catch {
      return c.json({ error: "gagal menetapkan identitas" }, 500);
    }
    if (c.req.header("x-user-id") !== k.userId) return c.json({ error: "gagal menetapkan identitas" }, 500);
    return next();
  };
}
