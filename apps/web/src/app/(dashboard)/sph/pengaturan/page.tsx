"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SkeletonCardGrid } from "@/components/ui/loading";
import { adalahAdmin } from "@/lib/nav";
import { useSession } from "@/lib/use-session";

// F15 — Pengaturan SPH: penomoran surat (kode tengah, nomor berikutnya, reset
// tahunan) + syarat default untuk SPH baru. Siapa pun ber-akses Sales Docs
// boleh melihat; yang boleh MENGUBAH hanya admin/superuser (BFF + apps/api).

interface Syarat {
  pembayaran: string;
  pengiriman: string;
  masaBerlaku: string;
  harga: string;
}

interface Pengaturan {
  kodeTengah: string;
  nomorBerikutnya: number;
  resetTahunan: boolean;
  tahunBerjalan: number | null;
  syaratDefault: Syarat;
  updatedBy: string | null;
  updatedAt: string | null;
  contohNomor: string;
}

const LABEL: Record<keyof Syarat, string> = {
  pembayaran: "Pembayaran",
  pengiriman: "Pengiriman",
  masaBerlaku: "Masa berlaku",
  harga: "Harga",
};
const KUNCI = Object.keys(LABEL) as (keyof Syarat)[];

export default function SphPengaturanPage() {
  const me = useSession();
  const admin = adalahAdmin(me as Parameters<typeof adalahAdmin>[0]);
  const [p, setP] = useState<Pengaturan | null>(null);
  const [form, setForm] = useState<Pengaturan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let aktif = true;
    (async () => {
      try {
        const res = await fetch("/api/sph/pengaturan", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "gagal memuat pengaturan");
        if (aktif) {
          setP(data);
          setForm(data);
        }
      } catch (e) {
        if (aktif) setError(String(e));
      }
    })();
    return () => {
      aktif = false;
    };
  }, []);

  async function simpan() {
    if (!form) return;
    setBusy(true);
    setError(null);
    setPesan(null);
    try {
      const res = await fetch("/api/sph/pengaturan", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kodeTengah: form.kodeTengah,
          nomorBerikutnya: form.nomorBerikutnya,
          resetTahunan: form.resetTahunan,
          syaratDefault: form.syaratDefault,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal menyimpan");
      const ulang = await fetch("/api/sph/pengaturan", { cache: "no-store" });
      const baru = await ulang.json();
      if (ulang.ok) {
        setP(baru);
        setForm(baru);
      }
      setPesan("Pengaturan tersimpan.");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (error && !p) return <p className="text-destructive p-6 text-sm">{error}</p>;
  if (!p || !form) {
    return (
      <div className="p-6">
        <SkeletonCardGrid count={2} />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Pengaturan SPH</h1>
          <p className="text-muted-foreground text-sm">
            Penomoran Surat Penawaran Harga & syarat default. {admin ? "" : "Hanya admin yang dapat mengubah."}
          </p>
        </div>
        <Link href="/sales-docs">
          <Button size="sm" variant="outline">
            Sales Docs
          </Button>
        </Link>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}
      {pesan && <p className="text-sm text-emerald-700 dark:text-emerald-400">{pesan}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Penomoran</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Nomor yang akan diberikan pada finalisasi berikutnya:{" "}
            <span className="font-mono font-semibold">{p.contohNomor}</span>
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-56">
              <Label htmlFor="sph-kode" className="mb-1 block text-xs">
                Kode tengah
              </Label>
              <Input
                id="sph-kode"
                value={form.kodeTengah}
                disabled={!admin}
                maxLength={30}
                onChange={(e) => setForm({ ...form, kodeTengah: e.target.value })}
              />
            </div>
            <div className="w-44">
              <Label htmlFor="sph-nomor" className="mb-1 block text-xs">
                Nomor berikutnya
              </Label>
              <Input
                id="sph-nomor"
                type="number"
                min={1}
                value={form.nomorBerikutnya}
                disabled={!admin}
                onChange={(e) => setForm({ ...form, nomorBerikutnya: Number(e.target.value) })}
              />
            </div>
            <label className="flex items-center gap-2 pb-2">
              <input
                type="checkbox"
                checked={form.resetTahunan}
                disabled={!admin}
                onChange={(e) => setForm({ ...form, resetTahunan: e.target.checked })}
              />
              Reset ke 00001 tiap pergantian tahun
            </label>
          </div>
          <p className="text-muted-foreground text-xs">
            Format: urut 5 digit / kode tengah / bulan Romawi / tahun (tanggal finalisasi, WIB). Isi &quot;nomor
            berikutnya&quot; agar melanjutkan urutan manual yang sedang dipakai. Default tidak reset (urut terus
            lintas tahun). Nomor yang sudah terpakai tidak bisa diberikan lagi — bila diset mundur, finalisasi akan
            ditolak.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Syarat default SPH baru</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {KUNCI.map((k) => (
            <div key={k}>
              <Label htmlFor={`sd-${k}`} className="mb-1 block text-xs">
                {LABEL[k]}
              </Label>
              <Input
                id={`sd-${k}`}
                value={form.syaratDefault[k]}
                maxLength={300}
                disabled={!admin}
                onChange={(e) => setForm({ ...form, syaratDefault: { ...form.syaratDefault, [k]: e.target.value } })}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {admin && (
        <Button disabled={busy} onClick={() => void simpan()}>
          {busy ? "Menyimpan…" : "Simpan pengaturan"}
        </Button>
      )}
      {p.updatedBy && (
        <p className="text-muted-foreground text-xs">
          Terakhir diubah oleh {p.updatedBy}
          {p.updatedAt ? ` · ${new Date(p.updatedAt).toLocaleString("id-ID")}` : ""}
        </p>
      )}
    </div>
  );
}
