"use client";

// F170 Komite KSO — tab Riwayat (17 Nov 2026, permintaan user): semua forum yang pernah terbit, terbaru dulu. Tiap usulan
// menampilkan status sekarang, usulan Komite di forum itu, dan putusan Direksi terakhir; klik baris = buka rinciannya.
// Tab Agenda Forum sejak itu hanya memuat yang siap dibahas. Bukan tab peran: datanya diminta lewat satu tab peran milik
// pengguna (pilihTabDaftar, cakupan terluas), jadi tak butuh fitur Akses Grup baru.

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CardPagination, usePagedList } from "@/components/ui/card-pagination";
import { EmptyState } from "@/components/ui/empty-state";
import type { TabKso } from "@/lib/kso-komite-access";

import { PolaGerbang } from "./pola-gerbang";
import { LabelStatus } from "./label-status";
import { STATUS_LABEL, kirim, rpJt } from "./types";

interface BarisRiwayat {
  forum_id: number; tanggal: string; hari: string; mode: string; jenis: string | null; urut: number | null;
  rencana_id: number; nomor: string | null; am_nama: string | null; faskes_nama: string | null; alat_nama: string | null;
  capex: number | null; pola_gerbang: string | null; status: string; usulan: string | null; putusan: string | null;
}

/** Tanggal hari ini di WIB (YYYY-MM-DD) dan geser n hari — tanpa jebakan zona waktu peramban. */
const hariIniWib = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
const geserHari = (t: string, n: number) => new Date(Date.parse(`${t}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const PUTUSAN: Record<string, string> = { SETUJU: "Setuju", BERSYARAT: "Bersyarat", TOLAK: "Ditolak" };

export function RiwayatForum({ tab, cakupan, onBuka, segar = 0 }: {
  tab: TabKso; cakupan: string; onBuka: (id: number) => void; segar?: number;
}) {
  const [baris, setBaris] = useState<BarisRiwayat[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [muatUlang, setMuatUlang] = useState(0);
  useEffect(() => {
    let batal = false;
    kirim<{ baris: BarisRiwayat[] }>(`/api/kso-komite/${tab}/riwayat-forum`)
      .then((d) => { if (!batal) { setBaris(d.baris ?? []); setErr(null); } })
      .catch((e: Error) => { if (!batal) setErr(e.message); });
    return () => { batal = true; };
  }, [tab, segar, muatUlang]);

  // 18 Nov 2026 (permintaan user): saring tanggal forum — dari/sampai (YYYY-MM-DD, banding teks aman untuk format ISO)
  const [dari, setDari] = useState("");
  const [sampai, setSampai] = useState("");
  const forum = useMemo(() => {
    const m = new Map<number, BarisRiwayat[]>();
    for (const b of baris ?? []) {
      if ((dari && b.tanggal < dari) || (sampai && b.tanggal > sampai)) continue;
      m.set(b.forum_id, [...(m.get(b.forum_id) ?? []), b]);
    }
    return [...m.values()];
  }, [baris, dari, sampai]);
  const cepat = (hari: number | "bulan") => {
    const kini = hariIniWib();
    setSampai(kini);
    setDari(hari === "bulan" ? `${kini.slice(0, 8)}01` : geserHari(kini, -hari));
  };
  const { visible, page, pageSize, setPage, setPageSize } = usePagedList(forum, tab, 10);

  if (err) return (
    <EmptyState title="Riwayat forum gagal dimuat" description={err}
      action={<Button size="sm" variant="outline" onClick={() => setMuatUlang((x) => x + 1)}>Coba lagi</Button>} />
  );
  if (!baris) return <p className="text-muted-foreground text-sm">Memuat…</p>;
  if (baris.length === 0) return <EmptyState title="Belum ada riwayat forum" description="Forum terbit otomatis pukul 14.00 hari Selasa/Kamis." />;

  return (
    <section className="space-y-3">
      <p className="text-muted-foreground text-xs">Semua forum, terbaru dulu — {cakupan}. Klik usulan untuk melihat rinciannya.</p>
      <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-white p-3 shadow-[var(--shadow-card)] dark:bg-card">
        <div><Label htmlFor="riwayat-dari">Dari tanggal</Label><Input id="riwayat-dari" type="date" value={dari} max={sampai || undefined} onChange={(e) => setDari(e.target.value)} /></div>
        <div><Label htmlFor="riwayat-sampai">Sampai tanggal</Label><Input id="riwayat-sampai" type="date" value={sampai} min={dari || undefined} onChange={(e) => setSampai(e.target.value)} /></div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={() => cepat(7)}>7 hari</Button>
          <Button size="sm" variant="outline" onClick={() => cepat(30)}>30 hari</Button>
          <Button size="sm" variant="outline" onClick={() => cepat("bulan")}>Bulan ini</Button>
          {(dari || sampai) && <Button size="sm" variant="ghost" onClick={() => { setDari(""); setSampai(""); }}>Semua tanggal</Button>}
        </div>
      </div>
      {forum.length === 0 && <EmptyState title="Tidak ada forum di rentang tanggal ini" description="Ubah tanggal atau tekan Semua tanggal." />}
      {visible.map((isi) => {
        const f = isi[0];
        return (
          <div key={f.forum_id} className="rounded-xl border bg-white p-3 shadow-[var(--shadow-card)] dark:bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">Forum {f.hari}, {f.tanggal}</span>
              <span className="text-muted-foreground text-xs">
                {isi.filter((x) => x.jenis === "A").length} Agenda A · {isi.filter((x) => x.jenis === "B").length} Agenda B
              </span>
            </div>
            <ul className="mt-2 divide-y">
              {isi.map((b) => (
                <li key={`${b.jenis}-${b.rencana_id}`}>
                  <button type="button" onClick={() => onBuka(b.rencana_id)}
                    className="hover:bg-accent flex w-full flex-wrap items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm">
                    <span className="min-w-0">
                      {/* nomor tampil = urutan di dalam jenisnya (urut DB untuk Agenda B dimulai 101) */}
                      <b>{b.jenis}{isi.filter((x) => x.jenis === b.jenis).indexOf(b) + 1}</b> · {b.faskes_nama} · {b.alat_nama}
                      {b.capex != null && <> · {rpJt(b.capex)}</>}
                      <span className="text-muted-foreground block text-xs">
                        {b.jenis === "B" ? "Laporan jalur cepat" : <>Usulan Komite: {b.usulan ? STATUS_LABEL[b.usulan] ?? b.usulan : "belum dirumuskan"}</>}
                        {b.putusan && <> · Direksi: {PUTUSAN[b.putusan] ?? b.putusan}</>}
                        {b.am_nama && <> · AM {b.am_nama}</>}
                      </span>
                    </span>
                    <span className="flex items-center gap-2"><PolaGerbang pola={b.pola_gerbang} /><LabelStatus status={b.status} /></span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <CardPagination total={forum.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize}
        label="forum" sizes={[10, 20, 50]} perLabel="Forum/hal:" />
    </section>
  );
}
