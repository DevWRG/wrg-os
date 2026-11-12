"use client";

// F170 Komite KSO — SPH KSO (issue #2297, migrasi 312). "Terbitkan penawaran" sekaligus menerbitkan Surat Penawaran
// Harga KSO bernomor, ditandatangani Direktur, berlaku 30 hari, harga per test belum termasuk PPN 11%. PDF dibuat di
// server dari snapshot kso.sph; layar ini hanya memilih harga & penanda tangan, lalu menampilkan/mengunduh SPH-nya.

import { FileText } from "lucide-react";
import { useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TabKso } from "@/lib/kso-komite-access";
import { cn } from "@/lib/utils";

import { rp, waktu, type Detail } from "./types";

type Jalankan = (aksi: string, body: Record<string, unknown>) => Promise<void>;

const urlSph = (tab: TabKso, id: number, sid: number) => `/api/kso-komite/${tab}/rencana/${id}/sph/${sid}`;
const angka = (s: string) => (s.trim() === "" ? null : Number(s.replace(/\./g, "").replace(",", ".")));

/** Form Sekretariat / Admin Sales: harga per test + penanda tangan Direktur → penawaran + SPH terbit bersamaan. */
export function FormPenawaranSph({ d, label, awal, jalankan }: { d: Detail; label: string; awal: number | null; jalankan: Jalankan }) {
  const kandidat = d.ttd_kandidat ?? [];
  const [harga, setHarga] = useState(awal == null ? "" : String(awal));
  const [ttd, setTtd] = useState<string>(d.ttd_default ?? kandidat[0]?.userId ?? "");
  const [sibuk, setSibuk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const kirim = async () => {
    setSibuk(true); setErr(null);
    try { await jalankan("penawaran", { harga: angka(harga), ttd_user_id: ttd || null }); }
    catch (e) { setErr((e as Error).message); }
    finally { setSibuk(false); }
  };
  return (
    <div className="border-primary-dark/40 space-y-3 rounded-lg border bg-white p-4 dark:bg-card">
      <h3 className="font-semibold">Terbitkan penawaran + SPH KSO</h3>
      <div className="space-y-1">
        <Label htmlFor="harga-penawaran">{label}</Label>
        <Input id="harga-penawaran" inputMode="numeric" value={harga} onChange={(e) => setHarga(e.target.value)} className="max-w-[14rem]" />
      </div>
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">Penanda tangan SPH (Direktur)</legend>
        {kandidat.length === 0 ? (
          <p className="text-destructive text-sm">Belum ada akun di grup Direktur — SPH tidak bisa diterbitkan. Hubungi admin.</p>
        ) : (
          kandidat.map((k) => (
            <label key={k.userId} className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="radio" name="ttd-sph" value={k.userId} checked={ttd === k.userId} onChange={() => setTtd(k.userId)} />
              <span>{k.nama}<span className="text-muted-foreground"> — {k.jabatan ?? "Direktur"}</span>
                {k.userId === d.ttd_default && <span className="text-muted-foreground text-xs"> · default</span>}</span>
            </label>
          ))
        )}
      </fieldset>
      <p className="text-muted-foreground text-xs">SPH bernomor terbit otomatis: harga per test belum termasuk PPN 11%, berlaku 30 hari,
        memuat masa KSO, volume minimum, dan ketentuan wajib dari mandat.</p>
      {err && <p className="text-destructive text-sm">{err}</p>}
      <Button disabled={!harga.trim() || !ttd || sibuk} onClick={kirim}>Terbitkan penawaran &amp; SPH</Button>
    </div>
  );
}

/** Daftar SPH KSO yang sudah terbit untuk rencana ini (terbaru dulu) + tombol unduh PDF. */
export function BagianSph({ tab, d }: { tab: TabKso; d: Detail }) {
  const daftar = d.sph ?? [];
  if (daftar.length === 0) return null;
  const hariIni = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
  return (
    <section>
      <h3 className="mb-1.5 text-sm font-semibold">SPH KSO</h3>
      <ul className="space-y-2">
        {daftar.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
            <div className="min-w-0">
              <div className="font-mono text-xs">{s.nomor}</div>
              <div>{rp(s.harga_per_test)}/test · {s.tenor_bulan} bln{s.volume_minimum ? ` · min ${s.volume_minimum} test/bln` : ""}</div>
              <div className="text-muted-foreground text-xs">
                Terbit {waktu(s.terbit_at)} · ttd {s.ttd_nama} ·{" "}
                <span className={cn(s.berlaku_sampai < hariIni && "text-destructive font-medium")}>
                  {s.berlaku_sampai < hariIni ? "kedaluwarsa" : "berlaku"} s/d {s.berlaku_sampai}
                </span>
              </div>
            </div>
            <a href={urlSph(tab, Number(d.rencana.id), s.id)} target="_blank" rel="noreferrer" className={cn(buttonVariants({ size: "sm" }))}>
              <FileText aria-hidden />Unduh SPH
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
