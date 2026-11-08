"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// F61 Tutup Buku Countdown — bentuk data = apps/api/src/repo/tutup-buku.ts ringkasTutupBuku().
interface Ringkas {
  bulan: string; tanggal: string; digeser: boolean; catatan: string | null; sisa_hari_kerja: number;
  regions: { region: string; so: number; so_nilai: number; do: number; do_nilai: number; am: number }[];
}
const rpJt = (n: number) => `Rp ${(n / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
const tglPanjang = (d: string) =>
  new Date(`${d}T00:00:00+07:00`).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", weekday: "long", day: "numeric", month: "long", year: "numeric" });

export function KartuTutupBuku({ bolehUbah }: { bolehUbah: boolean }) {
  const [d, setD] = useState<Ringkas | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ubah, setUbah] = useState(false);
  const [tgl, setTgl] = useState("");
  const [catatan, setCatatan] = useState("");
  const [pratinjau, setPratinjau] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);

  const muat = useCallback(() => {
    fetch("/api/tutup-buku").then(async (r) => {
      const x = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((x as { error?: string }).error ?? `HTTP ${r.status}`);
      setD(x as Ringkas); setErr(null);
    }).catch((e: Error) => setErr(e.message));
  }, []);
  useEffect(() => { muat(); }, [muat]);

  const simpan = async (tanggal: string | null) => {
    if (!d) return;
    setSibuk(true);
    const r = await fetch(`/api/tutup-buku/${d.bulan}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ tanggal, catatan }) });
    const x = await r.json().catch(() => ({}));
    setSibuk(false);
    if (!r.ok) { setErr((x as { error?: string }).error ?? `HTTP ${r.status}`); return; }
    setUbah(false); muat();
  };
  const lihat = async (sisa: number) => {
    const r = await fetch(`/api/tutup-buku/pratinjau?sisa=${sisa}`);
    const x = (await r.json().catch(() => ({}))) as { hasil?: { tujuan: string; payload?: string; skipped?: string }[]; error?: string };
    if (!r.ok) { setPratinjau(`Gagal memuat pratinjau: ${x.error ?? r.status}`); return; }
    setPratinjau((x.hasil ?? []).map((h) => `— ${h.tujuan} —\n${h.payload ?? `(tidak dikirim: ${h.skipped ?? "—"})`}`).join("\n\n") || "Tidak ada yang dikirim.");
  };

  if (err) return <p className="text-destructive text-sm">Tutup buku: {err}</p>;
  if (!d) return null;
  const mendesak = d.sisa_hari_kerja >= 0 && d.sisa_hari_kerja <= 3;
  return (
    <div className={cn("space-y-3 rounded-lg border px-3 py-3", mendesak ? "border-red-500/40 bg-red-500/10" : "bg-card")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <CalendarClock className={cn("mt-0.5 size-4", mendesak ? "text-red-700 dark:text-red-400" : "text-muted-foreground")} />
          <div>
            <div className="text-sm font-medium">
              Tutup buku {new Date(`${d.bulan}-01T00:00:00+07:00`).toLocaleDateString("id-ID", { month: "long", year: "numeric" })}: {tglPanjang(d.tanggal)}
              {" · "}
              <span className={cn(mendesak && "font-semibold text-red-700 dark:text-red-400")}>
                {d.sisa_hari_kerja < 0 ? "sudah lewat" : d.sisa_hari_kerja === 0 ? "HARI INI" : `${d.sisa_hari_kerja} hari kerja lagi`}
              </span>
            </div>
            <div className="text-muted-foreground text-xs">
              {d.digeser ? `Digeser Finance${d.catatan ? ` — ${d.catatan}` : ""}` : "Bawaan: hari kerja terakhir bulan"} · penjualan belum difaktur:{" "}
              {d.regions.map((r) => `${r.region === "LAIN" ? "tanpa region" : r.region} ${r.so} SO (${rpJt(r.so_nilai)}) + ${r.do} DO (${rpJt(r.do_nilai)})`).join(" · ") || "tidak ada"}
            </div>
          </div>
        </div>
        {bolehUbah && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => { setUbah(!ubah); setTgl(d.tanggal); setCatatan(d.catatan ?? ""); }}>Ubah tanggal</Button>
            {[7, 3, 1].map((n) => <Button key={n} size="sm" variant="outline" onClick={() => lihat(n)}>Pratinjau H-{n}</Button>)}
          </div>
        )}
      </div>
      {ubah && (
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" className="w-44" value={tgl} onChange={(e) => setTgl(e.target.value)} aria-label="Tanggal tutup buku" />
          <Input className="w-64" placeholder="Catatan (mis. tutup buku dimajukan)" value={catatan} onChange={(e) => setCatatan(e.target.value)} />
          <Button size="sm" onClick={() => simpan(tgl)} disabled={sibuk}>Simpan</Button>
          {d.digeser && <Button size="sm" variant="ghost" onClick={() => simpan(null)} disabled={sibuk}>Kembali ke hari kerja terakhir</Button>}
        </div>
      )}
      {pratinjau !== null && (
        <div className="rounded-lg border p-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium">Pratinjau pengingat (belum dikirim)</span>
            <Button size="sm" variant="ghost" onClick={() => setPratinjau(null)}>Tutup</Button>
          </div>
          <pre className="text-xs whitespace-pre-wrap">{pratinjau}</pre>
          <p className="text-muted-foreground mt-2 text-xs">Dikirim otomatis pukul 08.20 pada H-7, H-3, dan H-1 hari kerja ke grup sales tiap region; H-1 juga ke grup HoD — bila saklarnya dinyalakan admin sistem.</p>
        </div>
      )}
    </div>
  );
}
