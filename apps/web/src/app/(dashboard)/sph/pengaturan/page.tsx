"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, Hash, Layers, Loader2, Lock, RotateCcw, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SkeletonCardGrid } from "@/components/ui/loading";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TierBadge, ambilJson, pesanRamah, tglWaktu, useToast } from "@/components/sph/sph-ui";
import { adalahAdmin } from "@/lib/nav";
import { pratinjauNomorSph } from "@/lib/sph-hitung";
import { useSession } from "@/lib/use-session";

// F15 — Pengaturan SPH: penomoran surat (kode tengah, nomor berikutnya, reset
// tahunan) + syarat default untuk SPH baru. Siapa pun ber-akses Sales Docs
// boleh melihat; yang boleh MENGUBAH hanya admin/superuser (BFF + apps/api).
// Pratinjau nomor berubah seketika saat mengetik (lib/sph-hitung.ts, salinan
// aturan server); nomor sesungguhnya tetap diberikan server saat approve.
//
// Sejak migrasi 301 juga: jenjang diskon (jatah HoD Business & Direktur di atas
// batas SKU, batas diskon tambahan) + tautan ke Setup Harga, sumber batas
// diskon per SKU (nilai terbit).

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
  tambahanHodPp: number;
  tambahanDirekturPp: number;
  diskonTotalMaksPct: number;
  updatedBy: string | null;
  updatedAt: string | null;
  contohNomor: string;
}

const LABEL: Record<keyof Syarat, string> = {
  pembayaran: "Pembayaran",
  pengiriman: "Pengiriman",
  masaBerlaku: "Masa berlaku penawaran",
  harga: "Keterangan harga",
};
const KUNCI = Object.keys(LABEL) as (keyof Syarat)[];

type KunciTier = "tambahanHodPp" | "tambahanDirekturPp" | "diskonTotalMaksPct";
const TIER_ISIAN: { k: KunciTier; label: string; bantu: string }[] = [
  { k: "tambahanHodPp", label: "Jatah HoD Business (poin %)", bantu: "Di atas batas produk sampai sebanyak ini → perlu persetujuan HoD saat review." },
  { k: "tambahanDirekturPp", label: "Jatah Direktur (poin %)", bantu: "Setelah jatah HoD, sampai sebanyak ini lagi → perlu persetujuan Direktur. Di atasnya ditolak." },
  { k: "diskonTotalMaksPct", label: "Diskon tambahan tanpa persetujuan (poin %)", bantu: "0 = setiap diskon tambahan seluruh SPH minimal perlu persetujuan HoD." },
];
const tierSalah = (n: number) => !Number.isFinite(n) || n < 0 || n >= 100;

export default function SphPengaturanPage() {
  const me = useSession();
  const admin = adalahAdmin(me as Parameters<typeof adalahAdmin>[0]);
  const { toast, node: toastNode } = useToast();
  const [p, setP] = useState<Pengaturan | null>(null);
  const [form, setForm] = useState<Pengaturan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let aktif = true;
    ambilJson<Pengaturan>("/api/sph/pengaturan")
      .then((data) => {
        if (!aktif) return;
        setP(data);
        setForm(data);
      })
      .catch((e) => aktif && setError(pesanRamah(e, "Pengaturan tidak bisa dimuat.")));
    return () => {
      aktif = false;
    };
  }, []);

  const pratinjau = useMemo(() => (form ? pratinjauNomorSph(form) : null), [form]);
  const berubah = useMemo(
    () =>
      !!p &&
      !!form &&
      (p.kodeTengah !== form.kodeTengah ||
        p.nomorBerikutnya !== form.nomorBerikutnya ||
        p.resetTahunan !== form.resetTahunan ||
        TIER_ISIAN.some(({ k }) => p[k] !== form[k]) ||
        KUNCI.some((k) => p.syaratDefault[k] !== form.syaratDefault[k])),
    [p, form],
  );
  const syaratKosong = !!form && KUNCI.some((k) => !form.syaratDefault[k].trim());
  const tierTakSah = !!form && TIER_ISIAN.some(({ k }) => tierSalah(form[k]));

  async function simpan() {
    if (!form) return;
    setBusy(true);
    try {
      await ambilJson("/api/sph/pengaturan", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kodeTengah: form.kodeTengah.trim(),
          nomorBerikutnya: form.nomorBerikutnya,
          resetTahunan: form.resetTahunan,
          syaratDefault: form.syaratDefault,
          tambahanHodPp: form.tambahanHodPp,
          tambahanDirekturPp: form.tambahanDirekturPp,
          diskonTotalMaksPct: form.diskonTotalMaksPct,
        }),
      });
      const baru = await ambilJson<Pengaturan>("/api/sph/pengaturan");
      setP(baru);
      setForm(baru);
      toast("sukses", "Pengaturan tersimpan", `Nomor berikutnya: ${baru.contohNomor}`);
    } catch (e) {
      toast("gagal", "Belum tersimpan", pesanRamah(e));
    } finally {
      setBusy(false);
    }
  }

  if (error && !p) {
    return <p className="border-destructive/40 bg-card text-destructive m-4 rounded-lg border px-3 py-2 text-sm sm:m-6">{error}</p>;
  }
  if (!p || !form) {
    return (
      <div className="p-4 sm:p-6">
        <SkeletonCardGrid count={2} />
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4 sm:p-6">
      {toastNode}
      <div className="space-y-1">
        <Link href="/sph" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs">
          <ArrowLeft className="size-3.5" /> Daftar SPH
        </Link>
        <h1 className="text-2xl font-semibold">Pengaturan SPH</h1>
        <p className="text-muted-foreground text-sm">Format nomor surat dan syarat standar untuk SPH baru.</p>
      </div>

      {!admin && (
        <p className="bg-card flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <Lock className="text-muted-foreground size-4" /> Hanya admin yang dapat mengubah pengaturan ini.
        </p>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Penomoran surat</CardTitle>
              <CardDescription>Format: urut 5 digit / kode tengah / bulan Romawi / tahun — memakai tanggal approve (WIB).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="sph-kode" className="mb-1.5 block">
                    Kode tengah
                  </Label>
                  <Input
                    id="sph-kode"
                    value={form.kodeTengah}
                    disabled={!admin}
                    maxLength={30}
                    className="font-mono"
                    aria-invalid={!!pratinjau?.masalah && /Kode/.test(pratinjau.masalah)}
                    onChange={(e) => setForm({ ...form, kodeTengah: e.target.value })}
                  />
                  <p className="text-muted-foreground mt-1 text-xs">Huruf, angka, titik, atau strip. Tanpa garis miring.</p>
                </div>
                <div>
                  <Label htmlFor="sph-nomor" className="mb-1.5 block">
                    Nomor urut berikutnya
                  </Label>
                  <Input
                    id="sph-nomor"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={Number.isNaN(form.nomorBerikutnya) ? "" : form.nomorBerikutnya}
                    disabled={!admin}
                    className="tabular-nums"
                    aria-invalid={!!pratinjau?.masalah && /Nomor/.test(pratinjau.masalah)}
                    onChange={(e) => setForm({ ...form, nomorBerikutnya: e.target.value === "" ? Number.NaN : Number(e.target.value) })}
                  />
                  <p className="text-muted-foreground mt-1 text-xs">Isi untuk melanjutkan urutan manual yang sedang dipakai.</p>
                </div>
              </div>
              <div className="bg-card flex items-start justify-between gap-4 rounded-lg border px-3 py-3">
                <span className="text-sm">
                  <span className="block font-medium">Mulai lagi dari 00001 tiap tahun baru</span>
                  <span className="text-muted-foreground text-xs">Mati = nomor urut terus lintas tahun.</span>
                </span>
                <Switch
                  checked={form.resetTahunan}
                  disabled={!admin}
                  onCheckedChange={(v: boolean) => setForm({ ...form, resetTahunan: v })}
                  aria-label="Reset nomor tiap tahun"
                />
              </div>
              <p className="text-muted-foreground text-xs">
                Nomor yang sudah terpakai tidak bisa diberikan lagi — bila diset mundur ke nomor lama, approve berikutnya akan ditolak.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Diskon berjenjang</CardTitle>
              <CardDescription>
                Batas diskon tiap produk mengikuti Setup Harga (nilai yang sudah dipublikasikan). Diskon di atas batas tetap bisa diajukan
                dengan persetujuan berjenjang:
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ol className="grid gap-2 text-sm sm:grid-cols-2">
                <li className="flex flex-wrap items-center gap-2"><TierBadge tier="normal" /> ≤ batas produk</li>
                <li className="flex flex-wrap items-center gap-2">
                  <TierBadge tier="hod" /> ≤ batas + {Number.isFinite(form.tambahanHodPp) ? form.tambahanHodPp : "…"} poin
                </li>
                <li className="flex flex-wrap items-center gap-2">
                  <TierBadge tier="direktur" /> ≤ batas +{" "}
                  {Number.isFinite(form.tambahanHodPp + form.tambahanDirekturPp)
                    ? Math.round((form.tambahanHodPp + form.tambahanDirekturPp) * 100) / 100
                    : "…"}{" "}
                  poin
                </li>
                <li className="flex flex-wrap items-center gap-2"><TierBadge tier="tolak" /> di atasnya — ditolak</li>
              </ol>
              <div className="grid gap-4 md:grid-cols-3">
                {TIER_ISIAN.map(({ k, label, bantu }) => (
                  <div key={k} className="min-w-0">
                    <Label htmlFor={`tier-${k}`} className="mb-1.5 block">
                      {label}
                    </Label>
                    <Input
                      id={`tier-${k}`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={99.99}
                      step={0.5}
                      value={Number.isNaN(form[k]) ? "" : form[k]}
                      disabled={!admin}
                      className="tabular-nums"
                      aria-invalid={tierSalah(form[k])}
                      onChange={(e) => setForm({ ...form, [k]: e.target.value === "" ? Number.NaN : Number(e.target.value) })}
                    />
                    <p className={tierSalah(form[k]) ? "text-destructive mt-1 text-xs" : "text-muted-foreground mt-1 text-xs"}>
                      {tierSalah(form[k]) ? "Isi 0 sampai kurang dari 100" : bantu}
                    </p>
                  </div>
                ))}
              </div>
              <div className="bg-card flex flex-col gap-3 rounded-lg border px-3 py-3 shadow-[var(--shadow-card)] sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm">
                  <span className="block font-medium">Batas diskon per produk</span>
                  <span className="text-muted-foreground text-xs">
                    Diatur HoD Business di Setup Harga — termasuk atur massal per brand/kategori. Hanya nilai yang sudah dipublikasikan yang dipakai SPH.
                  </span>
                </span>
                <Button variant="soft" className="w-full sm:w-auto" render={<Link href="/pricebook/setup" />}>
                  <Layers /> Buka Setup Harga <ExternalLink />
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Syarat standar SPH baru</CardTitle>
              <CardDescription>Terisi otomatis di setiap SPH baru (form web maupun #SPH WhatsApp). AM tetap bisa mengubahnya per SPH.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              {KUNCI.map((k) => (
                <div key={k}>
                  <Label htmlFor={`sd-${k}`} className="mb-1.5 block">
                    {LABEL[k]}
                  </Label>
                  <Textarea
                    id={`sd-${k}`}
                    rows={2}
                    value={form.syaratDefault[k]}
                    maxLength={300}
                    disabled={!admin}
                    aria-invalid={!form.syaratDefault[k].trim()}
                    onChange={(e) => setForm({ ...form, syaratDefault: { ...form.syaratDefault, [k]: e.target.value } })}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-5 lg:sticky lg:top-20">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Hash className="text-primary size-4" /> Nomor berikutnya
              </CardTitle>
              <CardDescription>Akan diberikan pada SPH berikutnya yang di-approve.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="border-primary-dark/50 bg-primary-soft rounded-lg border px-3 py-3 text-center dark:border-primary/50">
                {pratinjau?.nomor ? (
                  <p className="font-mono text-base font-semibold break-all">{pratinjau.nomor}</p>
                ) : (
                  <p className="text-destructive text-sm">{pratinjau?.masalah}</p>
                )}
              </div>
              {berubah && pratinjau?.nomor && pratinjau.nomor !== p.contohNomor && (
                <p className="text-muted-foreground text-xs">
                  Sebelumnya: <span className="font-mono">{p.contohNomor}</span>
                </p>
              )}
              {admin && (
                // Ditumpuk lebar penuh (utama di atas) — kartu samping sempit, dua
                // tombol sebaris bisa terpotong.
                <div className="flex flex-col gap-2 pt-1">
                  <Button
                    className="w-full"
                    disabled={busy || !berubah || !!pratinjau?.masalah || syaratKosong || tierTakSah}
                    onClick={() => void simpan()}
                  >
                    {busy ? <Loader2 className="animate-spin" /> : <Save />} {busy ? "Menyimpan…" : "Simpan pengaturan"}
                  </Button>
                  {berubah && (
                    <Button variant="outline" className="w-full" onClick={() => setForm(p)} disabled={busy}>
                      <RotateCcw /> Reset
                    </Button>
                  )}
                </div>
              )}
              {admin && syaratKosong && <p className="text-destructive text-xs">Semua syarat standar wajib diisi.</p>}
              {p.updatedBy && (
                <p className="text-muted-foreground border-t pt-3 text-xs">
                  Terakhir diubah {p.updatedBy}
                  {p.updatedAt ? ` · ${tglWaktu(p.updatedAt)}` : ""}
                </p>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
