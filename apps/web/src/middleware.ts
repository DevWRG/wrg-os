import { NextResponse, type NextRequest } from "next/server";

// Gerbang sesi (opsional, default MATI). Saat AUTH_ENABLED=true, rute dashboard
// butuh cookie sesi; tanpa itu → redirect ke /login. Verifikasi penuh JWT
// dilakukan apps/api; di sini cukup cek keberadaan cookie (edge-friendly).

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

function pass(req: NextRequest): NextResponse {
  const headers = new Headers(req.headers);
  headers.set(PATH_HEADER, req.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export function middleware(req: NextRequest) {
  if ((process.env.AUTH_ENABLED ?? "").toLowerCase() !== "true") return pass(req);
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return pass(req);
  if (req.cookies.get(SESSION_COOKIE)?.value) return pass(req);
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Jalankan di semua rute kecuali aset internal Next & favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
