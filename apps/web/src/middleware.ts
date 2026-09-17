import { NextResponse, type NextRequest } from "next/server";

import { sessionTokenValid } from "@/lib/session-token";

// Gerbang sesi (opsional, default MATI). Saat AUTH_ENABLED=true, rute dashboard
// DAN /api/* butuh cookie sesi yang TANDA TANGANNYA SAH — bukan sekadar ada.
//
// ⚠️ Dulu di sini cuma dicek keberadaan cookie, dengan alasan "verifikasi penuh
// JWT dilakukan apps/api". Itu benar untuk halaman (layout dashboard memanggil
// sessionUser() → /auth/me), tapi TIDAK untuk /api/*: route BFF menyuntik
// x-service-token lewat gatewayFetch, dan token itu mem-bypass JWT di apps/api.
// Jadi rantainya jadi: cookie asal-asalan → lolos middleware → BFF → service
// token → backend menulis. Terbukti 2026-09-18 di prod (port 3100) dan dev
// (3300): `cookie: wrg_session=ngasal` + POST /api/holidays dijawab backend
// "tanggal + keterangan wajib" — artinya payload sudah sampai ke apps/api, cuma
// isinya yang kurang. Bukan sekadar "viewer bisa menulis": penyerang tanpa akun
// pun bisa, karena nilai cookie tak pernah diperiksa.

const SESSION_COOKIE = "wrg_session";

// Path publik yang tak butuh sesi.
const PUBLIC_PREFIXES = ["/login", "/signup", "/forgot-password", "/api/auth/", "/_next/"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  // aset statis (punya ekstensi file) — biarkan lewat.
  return /\.[a-zA-Z0-9]+$/.test(pathname);
}

// Server Component tak bisa membaca pathname; layout dashboard butuh itu untuk
// gate RBAC per-rute (lihat (dashboard)/layout.tsx). Diteruskan lewat header.
const PATH_HEADER = "x-pathname";

// WEB_NOINDEX=true → environment ini TAK BOLEH terindeks mesin pencari.
// Dipakai instance DEMO (demo.wahanalifeline.co.id): subdomainnya publik, dan
// meski seluruh dashboard di balik login, halaman /login sendiri tetap bisa
// terindeks. Prod TIDAK menyalakan flag ini.
const NOINDEX = (process.env.WEB_NOINDEX ?? "").toLowerCase() === "true";
const ROBOTS_TAG = "noindex, nofollow, noarchive, nosnippet";

// Header dipasang di SEMUA jalur keluar (pass maupun redirect ke /login) — kalau
// hanya di pass(), justru halaman yang paling mungkin dirayapi (redirect ke
// /login) lolos tanpa penanda.
function noindexed(res: NextResponse): NextResponse {
  if (NOINDEX) res.headers.set("X-Robots-Tag", ROBOTS_TAG);
  return res;
}

function pass(req: NextRequest): NextResponse {
  const headers = new Headers(req.headers);
  headers.set(PATH_HEADER, req.nextUrl.pathname);
  return noindexed(NextResponse.next({ request: { headers } }));
}

// Sesi tak sah. Untuk halaman → redirect /login seperti dulu. Untuk /api/* →
// 401 JSON: klien fetch() yang menerima 307 ke /login akan mengikutinya diam-diam
// lalu mem-parse HTML halaman login sebagai JSON, dan gagalnya terbaca sebagai
// "backend error" alih-alih "sesi habis".
function tolak(req: NextRequest, pathname: string): NextResponse {
  if (pathname.startsWith("/api/")) {
    return noindexed(
      NextResponse.json({ error: "unauthenticated" }, { status: 401 }),
    );
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return noindexed(NextResponse.redirect(url));
}

export async function middleware(req: NextRequest) {
  // robots.txt disajikan dari sini, BUKAN lewat app/robots.ts, supaya prod tetap
  // membalas 404 apa adanya — menambah route metadata akan mengubah permukaan
  // publik prod (404 → 200) tanpa alasan.
  if (NOINDEX && req.nextUrl.pathname === "/robots.txt") {
    return noindexed(
      new NextResponse("User-agent: *\nDisallow: /\n", {
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
    );
  }
  if ((process.env.AUTH_ENABLED ?? "").toLowerCase() !== "true") return pass(req);
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return pass(req);
  if (await sessionTokenValid(req.cookies.get(SESSION_COOKIE)?.value)) return pass(req);
  return tolak(req, pathname);
}

export const config = {
  // Jalankan di semua rute kecuali aset internal Next & favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
