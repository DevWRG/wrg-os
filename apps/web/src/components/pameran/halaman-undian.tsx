"use client";

import { useCallback, useEffect, useState } from "react";

import { UndianSpinner, type KuponPeserta, type PemenangUndian } from "./undian-spinner";

// F173 — halaman undian tersendiri (/undian/pameran/<id>): satu layar untuk operator di panggung —
// isi hadiah & jumlah → Kocok → spinner layar penuh → riwayat pemenang (tandai hangus / pulihkan).
// Pemenang dipilih acak di server SEBELUM animasi (lihat undian-spinner.tsx). Warna brand
// eksplisit (bukan token tema) seperti layar panggung — dipakai di proyektor.

interface Riwayat { id: number; hadiah: string; status: string; diundi_at: string; nama: string; institusi: string; kode_kupon: string }
interface DataUndian { items: Riwayat[]; sisa_peserta: number; sampel: KuponPeserta[] }
interface Ringkas { nama: string; lokasi: string | null; jumlah: number }
type HasilKocok = { hadiah: string; pemenang: PemenangUndian[] };

async function kirim<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String((data as { error?: string }).error ?? `gagal (HTTP ${res.status})`));
  return data as T;
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const angka = (n: number) => n.toLocaleString("id-ID");
const jam = (t: string) => new Date(t).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" });

export function HalamanUndian({ id, bolehKocok }: { id: string; bolehKocok: boolean }) {
  const [acara, setAcara] = useState<Ringkas | null>(null);
  const [d, setD] = useState<DataUndian | null>(null);
  const [hadiah, setHadiah] = useState("");
  const [jumlah, setJumlah] = useState("1");
  const [yakin, setYakin] = useState(false);
  const [sibuk, setSibuk] = useState(false);
  const [spinner, setSpinner] = useState<(HasilKocok & { sampel: KuponPeserta[] }) | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const muat = useCallback(() => {
    const e = encodeURIComponent(id);
    kirim<Ringkas>(`/api/pameran/${e}/layar`).then(setAcara).catch((x: Error) => setErr(x.message));
    kirim<DataUndian>(`/api/pameran/${e}/undian`).then((x) => { setD(x); setErr(null); }).catch((x: Error) => setErr(x.message));
  }, [id]);
  useEffect(() => { muat(); }, [muat]);
  // peserta terus bertambah selama acara → segarkan angka sisa peserta tiap 15 dtk (bukan saat spinner)
  useEffect(() => {
    if (spinner) return;
    const t = setInterval(muat, 15000);
    return () => clearInterval(t);
  }, [muat, spinner]);

  const n = Number(jumlah);
  const sahJumlah = Number.isInteger(n) && n >= 1 && n <= 50;
  const bisaKocok = bolehKocok && !sibuk && hadiah.trim() !== "" && sahJumlah && (d?.sisa_peserta ?? 0) > 0;

  const kocok = async () => {
    if (!yakin) { setYakin(true); return; }
    setSibuk(true); setErr(null); setYakin(false);
    const sampel = d?.sampel ?? [];
    try {
      const r = await kirim<HasilKocok>(`/api/pameran/${encodeURIComponent(id)}/undian`, json("POST", { hadiah: hadiah.trim(), jumlah: n }));
      setSpinner({ ...r, sampel });
    } catch (x) { setErr((x as Error).message); } finally { setSibuk(false); }
  };
  const ubahStatus = async (r: Riwayat) => {
    try { await kirim(`/api/pameran/undian/${r.id}`, json("PATCH", { status: r.status === "menang" ? "hangus" : "menang" })); muat(); }
    catch (x) { setErr((x as Error).message); }
  };

  const input = "w-full rounded-xl border-0 bg-white px-4 py-3 text-lg text-slate-900 placeholder:text-slate-400 focus:ring-4 focus:ring-amber-300/60 focus:outline-none";

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#086f80] via-[#0ca6bd] to-[#2bd4a8] px-4 py-6 text-white sm:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/wahana-lifeline-white.png" alt="Wahana LifeLine" className="h-8 w-auto drop-shadow" />
            <div>
              <p className="text-xs font-semibold tracking-[0.2em] text-white/80 uppercase">Undian doorprize</p>
              <h1 className="text-2xl leading-tight font-bold sm:text-3xl">{acara?.nama ?? "…"}</h1>
            </div>
          </div>
          <div className="flex gap-6 text-right">
            <div><p className="text-3xl font-extrabold tabular-nums">{acara ? angka(acara.jumlah) : "—"}</p><p className="text-xs text-white/80">terdaftar</p></div>
            <div><p className="text-3xl font-extrabold tabular-nums">{d ? angka(d.sisa_peserta) : "—"}</p><p className="text-xs text-white/80">belum pernah menang</p></div>
          </div>
        </header>

        {bolehKocok ? (
          <section className="rounded-2xl bg-white/15 p-4 backdrop-blur sm:p-6">
            <div className="grid gap-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
              <label className="block text-sm font-medium">Hadiah
                <input className={`${input} mt-1`} value={hadiah} onChange={(e) => { setHadiah(e.target.value); setYakin(false); }} placeholder="mis. Voucher belanja 500 rb" maxLength={120} />
              </label>
              <label className="block text-sm font-medium">Jumlah pemenang
                <input className={`${input} mt-1`} type="number" min={1} max={50} value={jumlah} onChange={(e) => { setJumlah(e.target.value); setYakin(false); }} />
              </label>
              <button type="button" disabled={!bisaKocok} onClick={kocok}
                className={`rounded-xl px-6 py-3 text-lg font-bold shadow-lg transition disabled:opacity-50 ${yakin ? "bg-red-500 text-white hover:bg-red-400" : "bg-amber-300 text-amber-950 hover:bg-amber-200"}`}>
                {sibuk ? "Mengocok…" : yakin ? "Yakin? Kocok sekarang" : "Kocok pemenang"}
              </button>
            </div>
            <p className="mt-3 text-xs text-white/80">
              Pemenang dipilih acak oleh sistem dari peserta yang belum pernah menang, langsung tercatat, lalu spinner terbuka layar penuh.
              Tidak bisa dikocok ulang — pemenang yang tidak hadir ditandai <b>hangus</b> lalu kocok lagi.
            </p>
          </section>
        ) : (
          <p className="rounded-xl bg-white/15 px-4 py-3 text-sm">Anda hanya bisa melihat hasil undian. Kocok butuh izin ubah menu Pameran.</p>
        )}

        {err && <p className="rounded-xl bg-red-600/90 px-4 py-3 text-sm font-medium">{err}</p>}

        <section className="rounded-2xl bg-white p-4 text-slate-900 shadow-xl sm:p-6">
          <h2 className="mb-3 text-lg font-bold">Pemenang ({d?.items.length ?? 0})</h2>
          {!d ? <p className="text-sm text-slate-500">Memuat…</p> : d.items.length === 0 ? (
            <p className="text-sm text-slate-500">Belum ada pemenang.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="p-2">Jam</th><th className="p-2">Hadiah</th><th className="p-2">Kupon</th><th className="p-2">Nama</th><th className="p-2">Institusi</th><th className="p-2">Status</th>
                </tr></thead>
                <tbody>
                  {[...d.items].reverse().map((r) => (
                    <tr key={r.id} className={`border-b border-slate-100 last:border-0 ${r.status === "hangus" ? "opacity-50" : ""}`}>
                      <td className="p-2 whitespace-nowrap">{jam(r.diundi_at)}</td>
                      <td className="p-2 font-medium">{r.hadiah}</td>
                      <td className="p-2 font-mono font-bold whitespace-nowrap">{r.kode_kupon}</td>
                      <td className="p-2">{r.nama}</td>
                      <td className="p-2">{r.institusi}</td>
                      <td className="p-2 whitespace-nowrap">
                        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${r.status === "menang" ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>
                          {r.status === "menang" ? "Menang" : "Hangus"}
                        </span>
                        {bolehKocok && (
                          <button type="button" onClick={() => ubahStatus(r)} className="ml-2 text-xs font-medium text-[#086f80] underline">
                            {r.status === "menang" ? "Tandai hangus" : "Pulihkan"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {spinner && (
        <UndianSpinner hadiah={spinner.hadiah} pemenang={spinner.pemenang} sampel={spinner.sampel}
          onTutup={() => { setSpinner(null); setHadiah(""); muat(); }} />
      )}
    </main>
  );
}
