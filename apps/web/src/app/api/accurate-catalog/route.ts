import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /accurate/:entity (mirror Accurate: items | customers).
// Sumber dropdown "pilih dari katalog" F22 Instalasi Alat — alat dari
// accurate_item, customer dari accurate_customer.
//
// Kenapa route BARU, bukan pakai yang sudah ada:
//   · /api/products menarik ?limit=10000 tanpa pencarian — untuk dropdown 6rb
//     item itu berarti seluruh katalog ditarik tiap kali sheet dibuka.
//   · /api/customers itu read-model dari `deal`, BUKAN accurate_customer, jadi
//     id-nya tak bisa dipakai sbg FK ke mirror.
//   · /accounts juga bukan: id-nya diturunkan dari accurate_invoice.customer_id,
//     sehingga customer yang BELUM punya faktur tak muncul sama sekali —
//     dropdown akan diam-diam menyembunyikan customer yang sah.
// Jadi yang dipakai mirror langsung + pencarian server-side (?q=).
//
// Katalog bersama (bukan data ber-scope per-AM), cukup guard auth.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const entity = url.searchParams.get("entity");
  if (entity !== "items" && entity !== "customers") {
    return Response.json({ error: "entity harus items|customers" }, { status: 400 });
  }
  const q = url.searchParams.get("q")?.trim() ?? "";
  // Batas kecil: ini pengisi dropdown, bukan penarik katalog. Tanpa kata kunci
  // pun tetap dibatasi supaya sheet yang baru dibuka tak menarik ribuan baris.
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);

  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const qs = new URLSearchParams({ limit: String(limit) });
  if (q) qs.set("q", q);
  try {
    return relay(await gatewayFetch(`/accurate/${entity}?${qs.toString()}`));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
