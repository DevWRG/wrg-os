// BFF PUBLIK F173 Pameran — form registrasi pengunjung di HP (tanpa sesi; middleware
// meloloskan /api/publik/). gatewayFetch menyuntik x-service-token, jadi file ini SENGAJA
// sempit: hanya endpoint tetap (/pameran-publik/<slug>, …/daftar, /pameran-kab-kota), slug divalidasi
// ketat, body dibangun ulang dari empat field saja — tak ada nilai mentah dari browser
// yang diteruskan ke path atau body apps/api.
import { gatewayFetch, relay } from "@/lib/gateway";

export const slugAman = (s: string) => (/^[a-z0-9][a-z0-9-]{2,59}$/.test(s) ? s : null);

const teks = (v: unknown, maks: number) => (typeof v === "string" ? v.slice(0, maks) : "");

/** IP pengunjung: Cloudflare Tunnel menaruhnya di cf-connecting-ip. */
function ipDari(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim().slice(0, 64);
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 64) || "?";
}

export async function info(slug: string): Promise<Response> {
  const s = slugAman(slug);
  if (!s) return Response.json({ error: "Pameran tidak ditemukan." }, { status: 404 });
  return relay(await gatewayFetch(`/pameran-publik/${s}`));
}

export async function daftar(req: Request, slug: string): Promise<Response> {
  const s = slugAman(slug);
  if (!s) return Response.json({ error: "Pameran tidak ditemukan." }, { status: 404 });
  const mentah = await req.text();
  if (mentah.length > 4000) return Response.json({ error: "Isian terlalu panjang." }, { status: 413 });
  let b: Record<string, unknown>;
  try {
    b = JSON.parse(mentah || "{}") as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Isian tidak sah." }, { status: 400 });
  }
  // Umpan bot: field tersembunyi yang tak pernah diisi manusia. Dibalas "sukses" palsu
  // supaya pengisi otomatis tak belajar bahwa ia ketahuan.
  if (teks(b.situs, 200)) return Response.json({ kode_kupon: "-", sudah_terdaftar: false, pameran: "" }, { status: 201 });
  const body = JSON.stringify({
    nama: teks(b.nama, 200), institusi: teks(b.institusi, 200), kab_kota_kode: teks(b.kab_kota_kode, 10), no_hp: teks(b.no_hp, 40),
  });
  return relay(await gatewayFetch(`/pameran-publik/${s}/daftar`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pengunjung-ip": ipDari(req),
      "x-pengunjung-ua": (req.headers.get("user-agent") ?? "").slice(0, 300),
    },
    body,
  }));
}

/** Daftar kab/kota untuk dropdown (data statis migrasi 260) — boleh di-cache browser/CDN. */
export async function kabKota(): Promise<Response> {
  const res = await gatewayFetch("/pameran-kab-kota");
  if (!res.ok) return relay(res);
  return new Response(await res.text(), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=86400" },
  });
}
