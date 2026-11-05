import { actorName, gatewayFetch, gerbang, putus, relay, teruskanGet } from "./_gerbang";

export const dynamic = "force-dynamic";

const KUNCI_QS = ["q", "buku", "periode", "limit", "offset"] as const;

export function GET(req: Request) {
  const src = new URL(req.url).searchParams;
  const qs = new URLSearchParams();
  for (const k of KUNCI_QS) { const v = src.get(k); if (v) qs.set(k, v); }
  return teruskanGet(`/arsip-dokumen${qs.size ? `?${qs}` : ""}`);
}

// Unggah. FormData dibangun ulang (header content-type asli membawa boundary
// body lama) dan hanya kolom yang dikenal yang diteruskan; `oleh` dari SESI.
const KOLOM = ["buku_kode", "tanggal_dokumen", "judul", "akun", "lokasi_fisik", "ref_faktur", "ref_sj", "ref_po", "ref_sn", "keterangan"] as const;

export async function POST(req: Request) {
  const g = await gerbang("create");
  if (!g.ok) return g.res;
  let form: FormData;
  try { form = await req.formData(); } catch { return Response.json({ error: "invalid multipart body" }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "berkas wajib dipilih", field: "file" }, { status: 400 });
  const fd = new FormData();
  fd.set("file", file, file.name);
  for (const k of KOLOM) fd.set(k, String(form.get(k) ?? ""));
  fd.set("oleh", actorName(g.me));
  try { return relay(await gatewayFetch("/arsip-dokumen", { method: "POST", body: fd })); } catch { return putus(); }
}
