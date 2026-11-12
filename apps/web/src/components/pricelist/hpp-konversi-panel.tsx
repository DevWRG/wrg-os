"use client";

// Tab "Konversi satuan HPP" di Setup Harga (migrasi 309).
//
// HPP Setup Harga dicatat per KEMASAN price book (box/kit/botol), qty faktur Accurate per
// satuan item Accurate (sering PCS). Accurate tak membawa rasio satuan, jadi konversinya
// diisi di sini: ISI per kemasan (HPP per satuan = HPP kemasan ÷ isi) ATAU langsung HPP per
// satuan (override, menang atas isi). Hasilnya dipakai laba kotor area (F150), Margin
// Reward insentif (F67, berlaku saat periode DRAFT dihitung ulang) dan Product Scorecard (F6).
//
// Daftar "Perlu dicek" = item yang barisnya gagal pagar kewajaran F150 (HPP × qty > 3× net)
// pada jendela terakhir. Pratinjau GP% dihitung di browser dari qty & net jendela itu.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Ruler } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { bacaAngka, galatIsian, gpPct, hppPerSatuan } from "@/lib/hpp-konversi";

// Cermin apps/api/src/repo/hpp-konversi.ts → KonversiRow.
export interface KonversiRow {
  item_id: number;
  item_no: string | null;
  item_name: string;
  unit_accurate: string | null;
  unit_faktur: string | null;
  kode: string | null;
  kemasan: string | null;
  satuan: string | null;
  hpp_kemasan: number | null;
  hpp: number | null;
  n_hpp: number | null;
  sumber: "kemasan" | "konversi" | "override" | null;
  qty: number;
  net: number;
  rasio: number | null;
  baris_curiga: number;
  isi_per_kemasan: number | null;
  hpp_per_satuan: number | null;
  catatan: string | null;
  diubah_oleh: string | null;
  diubah_at: string | null;
}

interface Daftar {
  periode_hpp: string;
  jendela: { from: string; to: string; hari: number };
  rasio_maks: number;
  curiga: KonversiRow[];
  terkonversi: KonversiRow[];
}

const rp = (n: number | null) =>
  n == null ? "—" : `Rp ${n.toLocaleString("id-ID", { maximumFractionDigits: n < 100 ? 2 : 0 })}`;
const num = (n: number | null) => (n == null ? "—" : n.toLocaleString("id-ID", { maximumFractionDigits: 2 }));
const pct = (n: number | null) => (n == null ? "—" : `${n.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`);
const isiTeks = (n: number | null) => (n == null ? "" : String(n).replace(".", ","));

const LABEL_SUMBER: Record<string, string> = {
  kemasan: "HPP kemasan (belum dikonversi)",
  konversi: "HPP ÷ isi kemasan",
  override: "HPP per satuan (override)",
};

const JENDELA = [90, 180, 365] as const;

export function HppKonversiPanel({ canEdit }: { canEdit: boolean }) {
  const [hari, setHari] = useState<number>(180);
  const [data, setData] = useState<Daftar | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [muat, setMuat] = useState(true);

  // Muat ulang = naikkan `versi`. setMuat(true) dipanggil di event handler (bukan di efek),
  // efek hanya mengisi state sesudah fetch selesai.
  const [versi, setVersi] = useState(0);
  const ambil = useCallback(() => { setMuat(true); setVersi((v) => v + 1); }, []);
  const gantiHari = (h: number) => { setMuat(true); setHari(h); };

  useEffect(() => {
    let aktif = true;
    (async () => {
      try {
        const res = await fetch(`/api/hpp-konversi?hari=${hari}`, { cache: "no-store" });
        const j = await res.json().catch(() => null);
        if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
        if (aktif) { setData(j as Daftar); setGalat(null); }
      } catch (e) {
        if (aktif) setGalat((e as Error).message || "Gagal memuat");
      } finally {
        if (aktif) setMuat(false);
      }
    })();
    return () => { aktif = false; };
  }, [hari, versi]);

  return (
    <div className="min-w-0 space-y-4">
      <Card>
        <CardContent className="space-y-3 pt-6 text-sm">
          <div className="flex items-start gap-3">
            <Ruler className="text-primary mt-0.5 size-5 shrink-0" />
            <p>
              HPP di Setup Harga dicatat <b>per kemasan</b>, sedangkan qty faktur Accurate memakai <b>satuan item
              Accurate</b>. Isi <b>isi per kemasan</b> (berapa satuan Accurate dalam satu kemasan HPP) atau langsung{" "}
              <b>HPP per satuan</b>. Dipakai laba kotor Profitabilitas Area, Product Scorecard, dan Margin Reward insentif
              (periode draft berubah saat dihitung ulang).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Jendela faktur:</span>
            {JENDELA.map((h) => (
              <Button key={h} size="sm" variant={hari === h ? "default" : "soft"} onClick={() => gantiHari(h)}>
                {h} hari
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={ambil} disabled={muat}>
              {muat ? <Loader2 className="animate-spin" /> : <RefreshCw />} Muat ulang
            </Button>
            {data && (
              <span className="text-muted-foreground text-xs">
                Periode HPP {data.periode_hpp} · {data.jendela.from} s/d {data.jendela.to}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {galat && (
        <Card className="border-destructive/40">
          <CardContent className="text-destructive pt-6 text-sm">
            Data tidak tersedia: {galat}. Pastikan migrasi <code>309_hpp_konversi_satuan.sql</code> sudah diterapkan.
          </CardContent>
        </Card>
      )}

      {muat && !data ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" /> Memuat…</div>
      ) : data ? (
        <>
          <Bagian
            judul="Perlu dicek satuannya"
            ikon={<AlertTriangle className="size-4 text-amber-600" />}
            keterangan={`HPP × qty lebih dari ${data.rasio_maks}× nilai jual (atau nilai jual ≤ 0) — baris ini sekarang dikeluarkan dari laba kotor.`}
            rows={data.curiga}
            kosong="Tidak ada item mencurigakan di jendela ini."
            canEdit={canEdit}
            onBerubah={ambil}
          />
          <Bagian
            judul="Sudah dikonversi"
            ikon={<CheckCircle2 className="size-4 text-emerald-600" />}
            keterangan="Item yang sudah punya konversi. Hapus konversi = kembali ke HPP kemasan."
            rows={data.terkonversi}
            kosong="Belum ada konversi."
            canEdit={canEdit}
            onBerubah={ambil}
          />
        </>
      ) : null}
    </div>
  );
}

function Bagian({ judul, ikon, keterangan, rows, kosong, canEdit, onBerubah }: {
  judul: string; ikon: React.ReactNode; keterangan: string; rows: KonversiRow[]; kosong: string;
  canEdit: boolean; onBerubah: () => void;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold">{ikon}{judul} <Badge variant="secondary">{rows.length}</Badge></h2>
        <p className="text-muted-foreground text-xs">{keterangan}</p>
      </div>
      {rows.length === 0 ? (
        <Card><CardContent className="pt-2"><EmptyState title={kosong} /></CardContent></Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map((r) => <KartuItem key={r.item_id} r={r} canEdit={canEdit} onBerubah={onBerubah} />)}
        </div>
      )}
    </section>
  );
}

function Angka({ label, nilai, tegas }: { label: string; nilai: string; tegas?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-muted-foreground text-[11px]">{label}</div>
      <div className={tegas ? "truncate font-semibold" : "truncate"}>{nilai}</div>
    </div>
  );
}

function KartuItem({ r, canEdit, onBerubah }: { r: KonversiRow; canEdit: boolean; onBerubah: () => void }) {
  const adaKonversi = r.isi_per_kemasan != null || r.hpp_per_satuan != null;
  const [buka, setBuka] = useState(false);
  const [isi, setIsi] = useState(isiTeks(r.isi_per_kemasan));
  const [hppSat, setHppSat] = useState(isiTeks(r.hpp_per_satuan));
  const [catatan, setCatatan] = useState(r.catatan ?? "");
  const [simpan, setSimpan] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);

  const isiN = bacaAngka(isi);
  const hppN = bacaAngka(hppSat);
  const salah = galatIsian(isiN, hppN);
  // Ambigu (beberapa HPP berbeda) hanya tuntas lewat override HPP per satuan.
  const ambigu = (r.n_hpp ?? 0) > 1;
  const hppBaru = salah ? null : hppPerSatuan(r.hpp_kemasan, isiN, hppN);
  const gpSekarang = ambigu ? null : gpPct(r.net, r.qty, r.hpp);
  const gpBaru = gpPct(r.net, r.qty, hppBaru);
  const gpBaruSah = ambigu && hppN == null ? null : gpBaru;

  async function kirim(hapus: boolean) {
    setSimpan(true);
    setPesan(null);
    try {
      const res = hapus
        ? await fetch(`/api/hpp-konversi?item_id=${r.item_id}`, { method: "DELETE" })
        : await fetch("/api/hpp-konversi", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ item_id: r.item_id, isi_per_kemasan: isiN, hpp_per_satuan: hppN, catatan: catatan.trim() || null }),
          });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setBuka(false);
      onBerubah();
    } catch (e) {
      setPesan((e as Error).message || "Gagal menyimpan");
    } finally {
      setSimpan(false);
    }
  }

  return (
    <Card className="min-w-0">
      <CardContent className="space-y-3 pt-5 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-medium break-words">{r.item_name}</div>
            <div className="text-muted-foreground text-xs break-all">
              {r.item_no ?? "tanpa kode Accurate"}{r.kode ? ` · ${r.kode}` : ""}
            </div>
          </div>
          {r.sumber && (
            <Badge variant={r.sumber === "kemasan" ? "outline" : "default"}>{LABEL_SUMBER[r.sumber] ?? r.sumber}</Badge>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          <Angka label="Satuan Accurate" nilai={r.unit_accurate ?? "—"} />
          <Angka label="Satuan di faktur" nilai={r.unit_faktur ?? "—"} />
          <Angka label="Kemasan Setup Harga" nilai={[r.kemasan, r.satuan].filter(Boolean).join(" / ") || "—"} />
          <Angka label="HPP per kemasan" nilai={rp(r.hpp_kemasan)} />
          <Angka label="HPP dipakai (per satuan)" nilai={rp(r.hpp)} tegas />
          <Angka label="Rasio HPP×qty ÷ net" nilai={r.rasio == null ? "—" : `${num(r.rasio)}×`} tegas />
          <Angka label="Qty faktur" nilai={num(r.qty)} />
          <Angka label="Net (tanpa PPN)" nilai={rp(r.net)} />
          <Angka label="GP% sekarang" nilai={pct(gpSekarang)} />
        </div>

        {ambigu && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Kode ini punya beberapa HPP berbeda di Setup Harga — hanya <b>HPP per satuan</b> yang bisa menuntaskannya.
          </p>
        )}
        {adaKonversi && !buka && (
          <p className="text-muted-foreground text-xs">
            Konversi: {r.hpp_per_satuan != null ? `HPP per satuan ${rp(r.hpp_per_satuan)}` : `isi ${num(r.isi_per_kemasan)} per kemasan`}
            {r.catatan ? ` · ${r.catatan}` : ""}
            {r.diubah_oleh ? ` · ${r.diubah_oleh}` : ""}
            {r.diubah_at ? `, ${new Date(r.diubah_at).toLocaleDateString("id-ID")}` : ""}
          </p>
        )}

        {canEdit && !buka && (
          <Button size="sm" variant={adaKonversi ? "soft" : "default"} onClick={() => setBuka(true)}>
            {adaKonversi ? "Ubah konversi" : "Atur konversi"}
          </Button>
        )}

        {canEdit && buka && (
          <div className="bg-card space-y-3 rounded-lg border p-3 shadow-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor={`isi-${r.item_id}`}>Isi per kemasan</Label>
                <Input id={`isi-${r.item_id}`} inputMode="decimal" placeholder="mis. 100" value={isi}
                  onChange={(e) => setIsi(e.target.value)} />
                <p className="text-muted-foreground text-[11px]">
                  Satuan {r.unit_accurate ?? r.unit_faktur ?? "Accurate"} dalam 1 {r.kemasan ?? "kemasan"}
                </p>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`hpp-${r.item_id}`}>HPP per satuan (opsional)</Label>
                <Input id={`hpp-${r.item_id}`} inputMode="decimal" placeholder="menang atas isi" value={hppSat}
                  onChange={(e) => setHppSat(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`cat-${r.item_id}`}>Catatan</Label>
              <Input id={`cat-${r.item_id}`} placeholder="sumber angka, mis. label kemasan" value={catatan} maxLength={500}
                onChange={(e) => setCatatan(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border bg-card p-2">
              <Angka label="HPP per satuan baru" nilai={rp(hppBaru)} tegas />
              <Angka label="GP% baru (jendela ini)" nilai={pct(gpBaruSah)} tegas />
            </div>
            {(salah || pesan) && <p className="text-destructive text-xs">{pesan ?? salah}</p>}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void kirim(false)} disabled={simpan || !!salah}>
                {simpan && <Loader2 className="animate-spin" />} Simpan
              </Button>
              {adaKonversi && (
                <Button size="sm" variant="destructive" onClick={() => void kirim(true)} disabled={simpan}>
                  Hapus konversi
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => { setBuka(false); setPesan(null); }} disabled={simpan}>
                Batal
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
