"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Ban,
  CircleAlert,
  ClipboardCheck,
  ExternalLink,
  FileText,
  History,
  Info,
  Loader2,
  PenLine,
  Send,
  ShieldAlert,
  ShieldCheck,
  Stamp,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SkeletonCardGrid } from "@/components/ui/loading";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/ui/use-confirm";
import {
  PelacakAlur,
  StatusSphBadge,
  TierBadge,
  ambilJson,
  pesanRamah,
  rupiah,
  tglWaktu,
  useToast,
  type AksiSph,
} from "@/components/sph/sph-ui";
import { cn } from "@/lib/utils";

// F15 — detail SPH dengan alur terpandu: pelacak tahap (dibuat → review HoD →
// approve & nomor → terkirim), SATU aksi utama sesuai peran & status penonton,
// alasan bila aksi tak tersedia, pratinjau PDF, syarat (bisa diubah sampai
// disetujui), penanda tangan, dan riwayat.
//
// Aksi apa yang boleh = GET /api/sph/:id/konteks (apps/api lib/sph-alur.ts,
// aturan yang sama dengan gerbang aksi). Gerbang sesungguhnya tetap di route
// aksi (review / approve / send / cancel / syarat / penanda-tangan /
// confirm-variant / direktur) — layar ini hanya mengikuti & menampilkan pesannya.
//
// Diskon berjenjang (migrasi 301): baris & diskon tambahan di atas batas
// ditampilkan mencolok; review HoD untuk SPH ber-pengecualian lewat dialog yang
// mewajibkan centang persetujuan (boleh menurunkan diskon tambahan); bila ada
// jenjang Direktur, langkah "Persetujuan Direktur" muncul di pelacak dan Direktur
// mendapat aksi utamanya sendiri. Info jenjang TIDAK dicetak di PDF customer.

interface Syarat {
  pembayaran: string;
  pengiriman: string;
  masaBerlaku: string;
  harga: string;
}

interface SphItem {
  id: number;
  nama: string;
  kemasan: string | null;
  qty: number;
  diskonRequested: number;
  priceList: number;
  hargaNett: number;
  nettPpn: number;
  variantConfirmed: boolean;
  variantConfirmedBy: string | null;
  diskonMaksSnapshot: number;
  tier: Tier;
  tierAlasan: string;
}

type Tier = "normal" | "hod" | "direktur";

interface SphDetail {
  id: string;
  customerId: string | null;
  customerName: string | null;
  status: string;
  nomorDokumen: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  hodReviewedBy: string | null;
  hodReviewedAt: string | null;
  createdAt: string;
  syarat: Syarat;
  penandaTangan: { nama: string; jabatan: string | null } | null;
  penandaTanganUserId: string | null;
  items: SphItem[];
  total: { priceList: number; nett: number; diskonTambahan: number; dpp: number; ppnRp: number; ppn: number };
  tier: Tier;
  diskonTambahan: { tipe: "persen" | "nominal"; nilai: number; rp: number } | null;
  diskonTambahanTier: Tier;
  diskonTambahanAlasan: string | null;
  diskonEfektifTotal: number;
  pengecualianDisetujuiBy: string | null;
  pengecualianDisetujuiAt: string | null;
  direkturApprovedBy: string | null;
  direkturApprovedAt: string | null;
}

interface Riwayat {
  jenis: string;
  oleh: string | null;
  waktu: string;
  judul: string;
  keterangan: string | null;
}

interface Konteks {
  aksi: AksiSph;
  pembuat: string | null;
  saya: { isCreator: boolean; bolehReviewPeran: boolean; bisaEdit: boolean; bolehDirekturPeran?: boolean };
  riwayat: Riwayat[];
}

interface Kandidat {
  userId: string;
  nama: string;
  jabatan: string | null;
  peran: string[];
}

interface Kontak {
  id: number;
  nama: string;
  jabatan: string | null;
  hpWa: string;
  utama: boolean;
}

const LABEL: Record<keyof Syarat, string> = {
  pembayaran: "Pembayaran",
  pengiriman: "Pengiriman",
  masaBerlaku: "Masa berlaku",
  harga: "Harga",
};
const KUNCI = Object.keys(LABEL) as (keyof Syarat)[];

const PERAN: Record<string, string> = {
  approver: "Anda",
  hod_review: "HoD peninjau",
  pembuat: "AM pembuat",
};

const pdfUrl = (id: string) => `/api/sph/${encodeURIComponent(id)}/pdf`;
const persenTeks = (f: number) => `${(Math.round(f * 10000) / 100).toLocaleString("id-ID")}%`;

// "6281234567890" → "0812-3456-7890" (tampilan saja).
function formatWa(n: string): string {
  const lokal = n.startsWith("62") ? `0${n.slice(2)}` : n;
  return lokal.replace(/^(\d{4})(\d{4})(\d+)$/, "$1-$2-$3");
}

const selectKelas =
  "border-input bg-card focus-visible:border-primary focus-visible:ring-primary-soft h-9 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3 dark:bg-input/30";

export default function SphDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast, node: toastNode } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();

  const [d, setD] = useState<SphDetail | null>(null);
  const [k, setK] = useState<Konteks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [syarat, setSyarat] = useState<Syarat | null>(null);
  const [dialog, setDialog] = useState<null | "approve" | "ttd" | "kirim" | "review">(null);

  const muat = useCallback(async () => {
    const [detail, konteks] = await Promise.all([
      ambilJson<SphDetail>(`/api/sph/${encodeURIComponent(id)}`),
      ambilJson<Konteks>(`/api/sph/${encodeURIComponent(id)}/konteks`).catch(() => null),
    ]);
    setD(detail);
    setSyarat(detail.syarat);
    setK(konteks);
  }, [id]);

  useEffect(() => {
    let aktif = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- muat() men-setState setelah fetch; disengaja.
    muat().catch((e) => aktif && setError(pesanRamah(e, "SPH tidak bisa dimuat.")));
    return () => {
      aktif = false;
    };
  }, [muat]);

  // Datang dari form Buat SPH → sapa sekali lalu bersihkan ?baru=1.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("baru") === "1") {
      toast("sukses", "SPH tersimpan", "Sudah masuk antrean review HoD Business.");
      router.replace(`/sph/${encodeURIComponent(id)}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sekali saat datang
  }, []);

  async function jalankan(kunci: string, url: string, init: RequestInit, sukses: string, isi?: (data: Record<string, unknown>) => string | undefined) {
    setBusy(kunci);
    try {
      const data = await ambilJson<Record<string, unknown>>(url, {
        headers: { "content-type": "application/json" },
        ...init,
      });
      await muat();
      toast("sukses", sukses, isi?.(data));
      return true;
    } catch (e) {
      toast("gagal", "Belum berhasil", pesanRamah(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const syaratBerubah = useMemo(() => !!d && !!syarat && KUNCI.some((x) => syarat[x] !== d.syarat[x]), [d, syarat]);

  if (error && !d) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        <Link href="/sph" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs">
          <ArrowLeft className="size-3.5" /> Daftar SPH
        </Link>
        <p className="border-destructive/40 bg-card text-destructive rounded-lg border px-3 py-2 text-sm">{error}</p>
      </div>
    );
  }
  if (!d || !syarat) {
    return (
      <div className="p-4 sm:p-6">
        <SkeletonCardGrid count={3} />
      </div>
    );
  }

  const aksi = k?.aksi ?? null;
  const pending = d.items.filter((it) => !it.variantConfirmed);
  const adaDiskon = d.items.some((it) => it.diskonRequested > 0);
  const terakhir = (jenis: string) => k?.riwayat.filter((r) => r.jenis === jenis).pop();
  const kirimEv = terakhir("sales.doc.send");
  const batalEv = terakhir("sales.doc.cancel");

  const perluDirektur = d.tier === "direktur";
  const pengecualian = d.items.filter((it) => it.tier !== "normal");
  const adaPengecualian = d.tier !== "normal";
  const langkah = [
    { judul: "SPH dibuat", oleh: k?.pembuat, waktu: d.createdAt },
    {
      judul: "Review HoD Business",
      oleh: d.hodReviewedBy,
      waktu: d.hodReviewedAt,
      ket: d.pengecualianDisetujuiBy ? "pengecualian diskon disetujui" : null,
    },
    ...(perluDirektur ? [{ judul: "Persetujuan Direktur", oleh: d.direkturApprovedBy, waktu: d.direkturApprovedAt }] : []),
    { judul: "Approve & nomor", oleh: d.approvedBy && d.approvedAt ? d.approvedBy : null, waktu: d.approvedAt, ket: d.nomorDokumen },
    { judul: "Terkirim ke customer", oleh: kirimEv?.oleh, waktu: kirimEv?.waktu, ket: kirimEv?.keterangan },
  ];
  // Jumlah langkah selesai bila ada langkah Direktur (5 langkah).
  const sampai = perluDirektur
    ? ({ draft: 1, hod_review: d.direkturApprovedAt ? 3 : 2, approved: 4, sent: 5 } as Record<string, number>)[d.status]
    : undefined;

  // ── Aksi utama untuk penonton ini ──
  const utama = (() => {
    if (!aksi) return null;
    switch (aksi.utama) {
      case "review":
        return {
          judul: "SPH ini menunggu review Anda",
          isi: adaPengecualian
            ? `Ada diskon di atas batas${perluDirektur ? " (juga perlu persetujuan Direktur)" : ""}. Periksa daftar pengecualian, lalu setujui secara eksplisit.`
            : "Periksa produk, harga, dan syarat. Setelah Anda setujui, SPH lanjut ke approve & penomoran.",
          tombol: adaPengecualian ? (
            <Button className="w-full" size="lg" disabled={!!busy} onClick={() => setDialog("review")}>
              <ShieldAlert /> Tinjau pengecualian diskon
            </Button>
          ) : (
            <Button
              className="w-full"
              size="lg"
              disabled={!!busy}
              onClick={() =>
                confirm(
                  {
                    title: "Setujui review SPH ini?",
                    description: `SPH untuk ${d.customerName ?? "customer"} (${rupiah(d.total.ppn)}) akan diteruskan ke tahap approve & penomoran.`,
                    confirmLabel: "Ya, setujui review",
                  },
                  () =>
                    void jalankan("review", `/api/sph/${encodeURIComponent(d.id)}/review`, { method: "POST", body: "{}" }, "Review disetujui", () =>
                      "SPH sekarang menunggu approve & nomor surat.",
                    ),
                )
              }
            >
              {busy === "review" ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Setujui review
            </Button>
          ),
        };
      case "direktur":
        return {
          judul: "Perlu persetujuan Direktur",
          isi: "SPH ini memuat diskon di atas jatah HoD Business. Setelah Anda setujui, SPH bisa di-approve & diberi nomor.",
          tombol: (
            <Button
              className="w-full"
              size="lg"
              disabled={!!busy}
              onClick={() =>
                confirm(
                  {
                    title: "Setujui diskon SPH ini sebagai Direktur?",
                    description: `SPH untuk ${d.customerName ?? "customer"} (${rupiah(d.total.ppn)}), diskon efektif ${persenTeks(d.diskonEfektifTotal)}. Persetujuan Anda dicatat di riwayat.`,
                    confirmLabel: "Ya, setujui",
                  },
                  () =>
                    void jalankan("direktur", `/api/sph/${encodeURIComponent(d.id)}/direktur`, { method: "POST", body: "{}" }, "Disetujui Direktur", () =>
                      "SPH sekarang bisa di-approve & diberi nomor.",
                    ),
                )
              }
            >
              {busy === "direktur" ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Setujui sebagai Direktur
            </Button>
          ),
        };
      case "approve":
        return {
          judul: "Siap di-approve",
          isi: "Approve memberi nomor surat resmi dan mengunci syarat. Pilih siapa yang menandatangani.",
          tombol: (
            <Button className="w-full" size="lg" disabled={!!busy} onClick={() => setDialog("approve")}>
              <Stamp /> Approve & beri nomor
            </Button>
          ),
        };
      case "konfirmasiVarian":
        return {
          judul: `Konfirmasi ${pending.length} item nama-kembar`,
          isi: "Beberapa produk bernama sama dengan varian lain. Pastikan kemasan/variannya benar di tabel produk, lalu klik Konfirmasi di tiap baris.",
          tombol: (
            <Button
              className="w-full"
              size="lg"
              variant="soft"
              onClick={() => document.getElementById("sph-produk")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              <ClipboardCheck /> Lihat item yang perlu dikonfirmasi
            </Button>
          ),
        };
      case "kirim":
        return {
          judul: "Siap dikirim ke customer",
          isi: "Kirim SPH lewat WhatsApp ke salah satu kontak customer di Accounts.",
          tombol: (
            <Button className="w-full" size="lg" disabled={!!busy} onClick={() => setDialog("kirim")}>
              <Send /> Kirim ke customer
            </Button>
          ),
        };
      default:
        return null;
    }
  })();

  // Bila tak ada aksi utama: jelaskan kenapa (sudut pandang penonton).
  const alasanTunggu = (() => {
    if (!aksi || utama) return null;
    if (d.status === "draft") return aksi.review.alasan;
    if (d.status === "hod_review") return aksi.approve.alasan;
    if (d.status === "approved") return aksi.kirim.alasan;
    return null;
  })();

  return (
    <div className="space-y-5 p-4 sm:p-6">
      {toastNode}
      {confirmDialog}

      {/* Kepala */}
      <div className="space-y-3">
        <Link href="/sph" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs">
          <ArrowLeft className="size-3.5" /> Daftar SPH
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              {d.nomorDokumen ? (
                <span className="bg-card rounded-md border px-2 py-0.5 font-mono text-xs font-medium">{d.nomorDokumen}</span>
              ) : (
                <span className="text-muted-foreground rounded-md border border-dashed px-2 py-0.5 text-xs font-semibold tracking-wide">DRAF · belum bernomor</span>
              )}
              <StatusSphBadge status={d.status} />
              {adaPengecualian && d.status !== "canceled" && (
                <TierBadge tier={aksi?.direkturPending ? "direktur" : d.tier} className={aksi?.direkturPending ? undefined : "opacity-90"} />
              )}
            </div>
            <h1 className="text-2xl font-semibold break-words">{d.customerName ?? "—"}</h1>
            <p className="text-muted-foreground text-sm">
              {d.items.length} produk · total <span className="text-foreground font-semibold tabular-nums">{rupiah(d.total.ppn)}</span>
              {k?.pembuat ? ` · dibuat ${k.pembuat}` : ""}
              {k?.saya.isCreator ? " (Anda)" : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="soft" render={<a href={pdfUrl(d.id)} target="_blank" rel="noopener noreferrer" />}>
              <FileText /> Lihat PDF
            </Button>
          </div>
        </div>
      </div>

      {/* Pelacak tahap */}
      <Card>
        <CardContent className="space-y-3">
          <PelacakAlur status={d.status} langkah={langkah} sampai={sampai} />
          {d.status === "canceled" && (
            <p className="text-muted-foreground flex items-center gap-2 border-t pt-3 text-sm">
              <Ban className="size-4" /> Dibatalkan{batalEv?.oleh ? ` oleh ${batalEv.oleh}` : ""}
              {batalEv?.waktu ? ` · ${tglWaktu(batalEv.waktu)}` : ""}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Kolom kanan lebih dulu di ponsel: aksi paling penting di atas */}
        <div className="space-y-5 lg:order-2 lg:sticky lg:top-20">
          <Card className={cn(utama && "border-primary-dark/60 dark:border-primary/60")}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {utama ? <BadgeCheck className="text-primary size-4" /> : <Info className="text-muted-foreground size-4" />}
                {utama ? utama.judul : "Langkah berikutnya"}
              </CardTitle>
              <CardDescription>
                {utama
                  ? utama.isi
                  : d.status === "sent"
                    ? "SPH sudah terkirim ke customer. PDF tetap bisa diunduh kapan saja."
                    : d.status === "canceled"
                      ? "SPH ini dibatalkan dan tidak bisa diproses lagi."
                      : (aksi?.petunjuk ?? "Memuat…")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {utama?.tombol}
              {!utama && alasanTunggu && (
                <p className="bg-card flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
                  <Info className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                  <span>{alasanTunggu}</span>
                </p>
              )}
              {d.status === "sent" && (
                <Button className="w-full" size="lg" render={<a href={pdfUrl(d.id)} target="_blank" rel="noopener noreferrer" />}>
                  <FileText /> Unduh PDF
                </Button>
              )}
              {/* Aksi pendamping */}
              {aksi && (aksi.gantiTtd.boleh || aksi.batal.boleh || (aksi.utama !== "kirim" && aksi.kirim.boleh)) && (
                <div className="flex flex-wrap gap-2 border-t pt-3">
                  {aksi.gantiTtd.boleh && (
                    <Button size="sm" variant="soft" onClick={() => setDialog("ttd")} disabled={!!busy}>
                      <PenLine /> Ganti penanda tangan
                    </Button>
                  )}
                  {aksi.batal.boleh && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive"
                      disabled={!!busy}
                      onClick={() =>
                        confirm(
                          {
                            title: "Batalkan SPH ini?",
                            description: "SPH yang dibatalkan tidak bisa diproses atau dikirim lagi. Nomor surat (bila ada) tidak dipakai ulang.",
                            confirmLabel: "Ya, batalkan",
                            cancelLabel: "Tidak",
                            destructive: true,
                          },
                          () => void jalankan("batal", `/api/sales/docs/${encodeURIComponent(d.id)}/cancel`, { method: "POST", body: "{}" }, "SPH dibatalkan"),
                        )
                      }
                    >
                      <Ban /> Batalkan SPH
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PenLine className="text-muted-foreground size-4" /> Penanda tangan
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {d.penandaTangan ? (
                <p>
                  <span className="font-medium">{d.penandaTangan.nama}</span>
                  {d.penandaTangan.jabatan && <span className="text-muted-foreground block text-xs">{d.penandaTangan.jabatan}</span>}
                </p>
              ) : (
                <p className="text-muted-foreground">Dipilih saat approve tahap 2.</p>
              )}
            </CardContent>
          </Card>

          {k && k.riwayat.length > 0 && (
            <Card size="sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <History className="text-muted-foreground size-4" /> Riwayat
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="border-border relative ml-1.5 space-y-3 border-l pl-4">
                  {[...k.riwayat].reverse().map((r, i) => (
                    <li key={`${r.jenis}-${r.waktu}-${i}`} className="relative text-sm">
                      <span className="bg-primary ring-card absolute top-1.5 -left-[1.3rem] size-2 rounded-full ring-4" aria-hidden />
                      <p className="font-medium">{r.judul}</p>
                      {r.keterangan && <p className="font-mono text-xs break-all">{r.keterangan}</p>}
                      <p className="text-muted-foreground text-xs">
                        {r.oleh ?? "sistem"} · {tglWaktu(r.waktu)}
                      </p>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="min-w-0 space-y-5 lg:order-1">
          {/* Produk */}
          <Card id="sph-produk" className="scroll-mt-20">
            <CardHeader>
              <CardTitle>Produk ({d.items.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {adaPengecualian && (
                <div
                  className={cn(
                    "space-y-2 rounded-lg border px-3 py-2.5 text-sm",
                    d.tier === "direktur"
                      ? "border-red-300 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-950/60 dark:text-red-100"
                      : "border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-600 dark:bg-amber-950/60 dark:text-amber-100",
                  )}
                >
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    <ShieldAlert className="size-4" /> Diskon di atas batas — {pengecualian.length} produk
                    {d.diskonTambahan && d.diskonTambahanTier !== "normal" ? " + diskon tambahan" : ""}
                  </p>
                  <ul className="list-disc space-y-0.5 pl-5 text-xs">
                    {pengecualian.map((it) => (
                      <li key={it.id}>
                        <span className="font-medium">{it.nama}</span> — diskon {persenTeks(it.diskonRequested)} (batas {persenTeks(it.diskonMaksSnapshot)}):{" "}
                        {it.tierAlasan.toLowerCase()}
                      </li>
                    ))}
                    {d.diskonTambahan && d.diskonTambahanTier !== "normal" && (
                      <li>
                        <span className="font-medium">Diskon tambahan {rupiah(d.diskonTambahan.rp)}</span> — diskon efektif{" "}
                        {persenTeks(d.diskonEfektifTotal)}: {(d.diskonTambahanAlasan ?? "").toLowerCase()}
                      </li>
                    )}
                  </ul>
                  <p className="text-xs">
                    {d.pengecualianDisetujuiBy
                      ? `Pengecualian disetujui HoD: ${d.pengecualianDisetujuiBy}${d.pengecualianDisetujuiAt ? ` · ${tglWaktu(d.pengecualianDisetujuiAt)}` : ""}.`
                      : "Menunggu persetujuan HoD Business saat review."}
                    {perluDirektur &&
                      (d.direkturApprovedBy
                        ? ` Disetujui Direktur: ${d.direkturApprovedBy}${d.direkturApprovedAt ? ` · ${tglWaktu(d.direkturApprovedAt)}` : ""}.`
                        : " Perlu persetujuan Direktur sebelum approve & nomor.")}
                  </p>
                </div>
              )}
              {pending.length > 0 && (
                <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                  {pending.length} item bernama sama dengan varian lain dan belum dikonfirmasi. Approve tertahan sampai semuanya dikonfirmasi
                  {aksi && !aksi.konfirmasiVarian.boleh && aksi.konfirmasiVarian.alasan ? ` (${aksi.konfirmasiVarian.alasan.toLowerCase()})` : ""}.
                </p>
              )}
              <div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground border-b text-left text-xs">
                      <th className="py-2 pr-2 font-medium">Produk</th>
                      <th className="py-2 pr-2 text-right font-medium">Qty</th>
                      <th className="hidden py-2 pr-2 text-right font-medium sm:table-cell">Harga list</th>
                      {adaDiskon && <th className="hidden py-2 pr-2 text-right font-medium sm:table-cell">Diskon</th>}
                      <th className="hidden py-2 pr-2 text-right font-medium sm:table-cell">Nett/unit</th>
                      <th className="py-2 text-right font-medium">Jumlah</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((it) => (
                      <tr key={it.id} className="border-b align-top last:border-0">
                        <td className="py-2 pr-2">
                          <p className="font-medium">{it.nama}</p>
                          <p className="text-muted-foreground text-xs">{it.kemasan ?? "—"}</p>
                          {it.tier !== "normal" && <TierBadge tier={it.tier} className="mt-1" />}
                          {/* ponsel: kolom harga disembunyikan → ringkas di bawah nama */}
                          <p className="text-muted-foreground text-xs tabular-nums sm:hidden">
                            {rupiah(it.hargaNett)}/unit
                            {it.diskonRequested > 0 ? ` · diskon ${Math.round(it.diskonRequested * 10000) / 100}%` : ""}
                          </p>
                          {!it.variantConfirmed ? (
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <span className="text-xs font-medium text-amber-700 dark:text-amber-400">Varian belum dikonfirmasi</span>
                              {aksi?.konfirmasiVarian.boleh && (
                                <Button
                                  size="xs"
                                  variant="soft"
                                  disabled={!!busy}
                                  onClick={() =>
                                    void jalankan(
                                      `varian-${it.id}`,
                                      `/api/sph/${encodeURIComponent(d.id)}/confirm-variant`,
                                      { method: "POST", body: JSON.stringify({ line_item_id: it.id }) },
                                      "Varian dikonfirmasi",
                                      () => it.nama,
                                    )
                                  }
                                >
                                  {busy === `varian-${it.id}` ? <Loader2 className="animate-spin" /> : <ClipboardCheck />} Konfirmasi
                                </Button>
                              )}
                            </div>
                          ) : it.variantConfirmedBy ? (
                            <p className="text-muted-foreground text-xs">varian dikonfirmasi {it.variantConfirmedBy}</p>
                          ) : null}
                        </td>
                        <td className="py-2 pr-2 text-right tabular-nums">{it.qty.toLocaleString("id-ID")}</td>
                        <td className="hidden py-2 pr-2 text-right tabular-nums sm:table-cell">{rupiah(it.priceList)}</td>
                        {adaDiskon && (
                          <td className="hidden py-2 pr-2 text-right tabular-nums sm:table-cell">
                            {it.diskonRequested > 0 ? `${Math.round(it.diskonRequested * 10000) / 100}%` : "–"}
                          </td>
                        )}
                        <td className="hidden py-2 pr-2 text-right tabular-nums sm:table-cell">{rupiah(it.hargaNett)}</td>
                        <td className="py-2 text-right font-medium tabular-nums">{rupiah(it.hargaNett * it.qty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <dl className="ml-auto max-w-xs space-y-1 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="tabular-nums">{rupiah(d.total.nett)}</dd>
                </div>
                {d.diskonTambahan && (
                  <>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">
                        Diskon tambahan{d.diskonTambahan.tipe === "persen" ? ` (${d.diskonTambahan.nilai}%)` : ""}
                      </dt>
                      <dd className="tabular-nums">−{rupiah(d.diskonTambahan.rp)}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Subtotal setelah diskon</dt>
                      <dd className="tabular-nums">{rupiah(d.total.dpp)}</dd>
                    </div>
                  </>
                )}
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">PPN 11%</dt>
                  <dd className="tabular-nums">{rupiah(d.total.ppn - d.total.dpp)}</dd>
                </div>
                <div className="flex justify-between gap-4 border-t pt-1.5 text-base font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular-nums">{rupiah(d.total.ppn)}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {/* Syarat */}
          <Card>
            <CardHeader>
              <CardTitle>Syarat & ketentuan</CardTitle>
              <CardDescription>
                {aksi?.ubahSyarat.boleh
                  ? "Bisa diubah sampai SPH disetujui."
                  : d.status === "draft" || d.status === "hod_review"
                    ? (aksi?.ubahSyarat.alasan ?? "")
                    : "Terkunci — SPH sudah disetujui."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {aksi?.ubahSyarat.boleh ? (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    {KUNCI.map((x) => (
                      <div key={x}>
                        <Label htmlFor={`syarat-${x}`} className="mb-1.5 block">
                          {LABEL[x]}
                        </Label>
                        <Textarea
                          id={`syarat-${x}`}
                          rows={2}
                          value={syarat[x]}
                          maxLength={300}
                          onChange={(e) => setSyarat({ ...syarat, [x]: e.target.value })}
                        />
                      </div>
                    ))}
                  </div>
                  {syaratBerubah && (
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setSyarat(d.syarat)} disabled={!!busy}>
                        Batal
                      </Button>
                      <Button
                        size="sm"
                        disabled={!!busy || KUNCI.some((x) => !syarat[x].trim())}
                        onClick={() =>
                          void jalankan(
                            "syarat",
                            `/api/sph/${encodeURIComponent(d.id)}/syarat`,
                            { method: "PUT", body: JSON.stringify(syarat) },
                            "Syarat tersimpan",
                          )
                        }
                      >
                        {busy === "syarat" && <Loader2 className="animate-spin" />} Simpan syarat
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[9rem_1fr]">
                  {KUNCI.map((x) => (
                    <div key={x} className="contents">
                      <dt className="text-muted-foreground">{LABEL[x]}</dt>
                      <dd>{d.syarat[x]}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </CardContent>
          </Card>

          {/* Pratinjau PDF */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <span>Pratinjau surat</span>
                <Button size="sm" variant="soft" render={<a href={pdfUrl(d.id)} target="_blank" rel="noopener noreferrer" />}>
                  <ExternalLink /> Buka di tab baru
                </Button>
              </CardTitle>
              <CardDescription>
                {d.nomorDokumen ? "PDF resmi berkop dengan nomor surat." : "Masih DRAF — nomor & tanda tangan muncul setelah approve."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <iframe
                title="Pratinjau PDF SPH"
                src={`${pdfUrl(d.id)}#view=FitH`}
                className="bg-card hidden h-[40rem] w-full rounded-lg border md:block"
              />
              <p className="text-muted-foreground text-sm md:hidden">Pratinjau tersedia di layar lebar. Ketuk &quot;Buka di tab baru&quot; untuk melihat PDF.</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {(dialog === "approve" || dialog === "ttd") && (
        <DialogTtd
          mode={dialog}
          d={d}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={async (userId, jabatan) => {
            const ok =
              dialog === "approve"
                ? await jalankan(
                    "approve",
                    `/api/sales/docs/${encodeURIComponent(d.id)}/approve`,
                    { method: "POST", body: JSON.stringify({ penanda_tangan_user_id: userId || undefined, penanda_tangan_jabatan: jabatan }) },
                    "SPH disetujui",
                    (data) => (data.nomor ? `Nomor surat: ${String(data.nomor)}` : undefined),
                  )
                : await jalankan(
                    "ttd",
                    `/api/sph/${encodeURIComponent(d.id)}/penanda-tangan`,
                    { method: "PUT", body: JSON.stringify({ user_id: userId, jabatan }) },
                    "Penanda tangan diganti",
                  );
            if (ok) setDialog(null);
          }}
        />
      )}
      {dialog === "review" && (
        <DialogReview
          d={d}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={async (diskonBaru) => {
            const ok = await jalankan(
              "review",
              `/api/sph/${encodeURIComponent(d.id)}/review`,
              {
                method: "POST",
                body: JSON.stringify({ setuju_pengecualian: true, ...(diskonBaru !== undefined ? { diskon_tambahan: diskonBaru } : {}) }),
              },
              "Review disetujui",
              () => (perluDirektur ? "Pengecualian disetujui. Menunggu persetujuan Direktur." : "Pengecualian disetujui. SPH menunggu approve & nomor."),
            );
            if (ok) setDialog(null);
          }}
        />
      )}
      {dialog === "kirim" && (
        <DialogKirim
          d={d}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={async (to, nama) => {
            const ok = await jalankan(
              "kirim",
              `/api/sales/docs/${encodeURIComponent(d.id)}/send`,
              { method: "POST", body: JSON.stringify({ to }) },
              "SPH terkirim",
              () => `Dikirim ke ${nama} lewat WhatsApp.`,
            );
            if (ok) setDialog(null);
          }}
        />
      )}
    </div>
  );
}

function DialogTtd({
  mode,
  d,
  busy,
  onClose,
  onSubmit,
}: {
  mode: "approve" | "ttd";
  d: SphDetail;
  busy: string | null;
  onClose: () => void;
  onSubmit: (userId: string, jabatan: string) => void;
}) {
  const [kandidat, setKandidat] = useState<Kandidat[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ttdId, setTtdId] = useState("");
  const [jabatan, setJabatan] = useState("");
  const [contohNomor, setContohNomor] = useState<string | null>(null);

  useEffect(() => {
    let aktif = true;
    ambilJson<{ kandidat: Kandidat[] }>(`/api/sph/${encodeURIComponent(d.id)}/penanda-tangan`)
      .then((r) => {
        if (!aktif) return;
        const list = r.kandidat ?? [];
        setKandidat(list);
        // Default: penanda tangan tersimpan → approver (diri sendiri) → pertama.
        const awal =
          list.find((c) => c.userId === d.penandaTanganUserId) ?? list.find((c) => c.peran.includes("approver")) ?? list[0];
        if (awal) {
          setTtdId(awal.userId);
          setJabatan(awal.userId === d.penandaTanganUserId ? (d.penandaTangan?.jabatan ?? awal.jabatan ?? "") : (awal.jabatan ?? ""));
        }
      })
      .catch((e) => aktif && setErr(pesanRamah(e)));
    if (mode === "approve") {
      ambilJson<{ contohNomor: string }>("/api/sph/pengaturan")
        .then((p) => aktif && setContohNomor(p.contohNomor))
        .catch(() => {});
    }
    return () => {
      aktif = false;
    };
  }, [d.id, d.penandaTanganUserId, d.penandaTangan, mode]);

  const sibuk = busy === "approve" || busy === "ttd";
  return (
    <Dialog open onOpenChange={(v) => !v && !sibuk && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "approve" ? "Approve & beri nomor surat" : "Ganti penanda tangan"}</DialogTitle>
          <DialogDescription>
            {mode === "approve"
              ? `SPH untuk ${d.customerName ?? "customer"} akan mendapat nomor resmi; syarat dikunci.`
              : "Nama penanda tangan dicetak di PDF dan teks SPH."}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {mode === "approve" && contohNomor && (
            <div className="border-primary/40 bg-primary-soft rounded-lg border px-3 py-2.5 text-sm">
              <p className="text-muted-foreground text-xs">Nomor yang akan diberikan</p>
              <p className="font-mono font-semibold">{contohNomor}</p>
            </div>
          )}
          {err ? (
            <p className="text-destructive text-sm">{err}</p>
          ) : !kandidat ? (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" /> Memuat daftar…
            </p>
          ) : (
            <>
              <div>
                <Label htmlFor="sph-ttd" className="mb-1.5 block">
                  Penanda tangan
                </Label>
                <select
                  id="sph-ttd"
                  className={selectKelas}
                  value={ttdId}
                  onChange={(e) => {
                    setTtdId(e.target.value);
                    setJabatan(kandidat.find((x) => x.userId === e.target.value)?.jabatan ?? "");
                  }}
                >
                  {kandidat.map((x) => (
                    <option key={x.userId} value={x.userId}>
                      {x.nama}
                      {x.peran.length ? ` (${x.peran.map((p) => PERAN[p] ?? p).join(", ")})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="sph-jabatan" className="mb-1.5 block">
                  Jabatan <span className="text-muted-foreground font-normal">(dicetak di bawah nama)</span>
                </Label>
                <Input id="sph-jabatan" value={jabatan} maxLength={100} placeholder="mis. Manajer Penjualan" onChange={(e) => setJabatan(e.target.value)} />
              </div>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sibuk}>
            Batal
          </Button>
          <Button disabled={sibuk || !kandidat || !ttdId} onClick={() => onSubmit(ttdId, jabatan)}>
            {sibuk ? <Loader2 className="animate-spin" /> : mode === "approve" ? <Stamp /> : <PenLine />}
            {mode === "approve" ? "Approve & beri nomor" : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogKirim({
  d,
  busy,
  onClose,
  onSubmit,
}: {
  d: SphDetail;
  busy: string | null;
  onClose: () => void;
  onSubmit: (to: string, nama: string) => void;
}) {
  const [kontak, setKontak] = useState<Kontak[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pilih, setPilih] = useState("");

  useEffect(() => {
    let aktif = true;
    ambilJson<{ kontak: Kontak[] }>(`/api/sph/${encodeURIComponent(d.id)}/kontak`)
      .then((r) => {
        if (!aktif) return;
        setKontak(r.kontak ?? []);
        if (r.kontak?.[0]) setPilih(r.kontak[0].hpWa);
      })
      .catch((e) => aktif && setErr(pesanRamah(e)));
    return () => {
      aktif = false;
    };
  }, [d.id]);

  const sibuk = busy === "kirim";
  const terpilih = kontak?.find((x) => x.hpWa === pilih);
  return (
    <Dialog open onOpenChange={(v) => !v && !sibuk && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Kirim SPH ke customer</DialogTitle>
          <DialogDescription>
            {d.nomorDokumen ? `SPH ${d.nomorDokumen}` : "SPH"} dikirim lewat WhatsApp ke kontak {d.customerName ?? "customer"}.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {err ? (
            <p className="text-destructive text-sm">{err}</p>
          ) : !kontak ? (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" /> Memuat kontak…
            </p>
          ) : kontak.length === 0 ? (
            <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <p className="font-medium">Customer ini belum punya kontak WhatsApp.</p>
              <p>SPH hanya bisa dikirim ke kontak yang terdaftar di Accounts. Tambahkan kontak dulu, lalu kembali ke sini.</p>
              {d.customerId && /^\d+$/.test(d.customerId) && (
                <Button size="sm" variant="soft" render={<Link href={`/accounts/${d.customerId}`} />}>
                  Buka Accounts
                </Button>
              )}
            </div>
          ) : (
            <div>
              <Label htmlFor="sph-kontak" className="mb-1.5 block">
                Kirim ke
              </Label>
              <select id="sph-kontak" className={selectKelas} value={pilih} onChange={(e) => setPilih(e.target.value)}>
                {kontak.map((x) => (
                  <option key={x.id} value={x.hpWa}>
                    {x.nama}
                    {x.jabatan ? ` — ${x.jabatan}` : ""} · {formatWa(x.hpWa)}
                    {x.utama ? " (utama)" : ""}
                  </option>
                ))}
              </select>
              <p className="text-muted-foreground mt-1.5 text-xs">Hanya kontak WA customer ini di Accounts yang bisa dipilih.</p>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sibuk}>
            Batal
          </Button>
          <Button disabled={sibuk || !terpilih} onClick={() => terpilih && onSubmit(terpilih.hpWa, terpilih.nama)}>
            {sibuk ? <Loader2 className="animate-spin" /> : <Send />} Kirim sekarang
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Review HoD untuk SPH ber-pengecualian: daftar baris di atas batas tampil
// mencolok, centang persetujuan WAJIB (server menolak tanpa itu), dan diskon
// tambahan boleh DITURUNKAN (tidak dinaikkan) sebelum disetujui.
function DialogReview({
  d,
  busy,
  onClose,
  onSubmit,
}: {
  d: SphDetail;
  busy: string | null;
  onClose: () => void;
  onSubmit: (diskonBaru: { tipe: "persen" | "nominal"; nilai: number } | null | undefined) => void;
}) {
  const [setuju, setSetuju] = useState(false);
  const [ubah, setUbah] = useState(false);
  const [nilai, setNilai] = useState<number>(d.diskonTambahan?.nilai ?? 0);
  const sibuk = busy === "review";
  const pengecualian = d.items.filter((it) => it.tier !== "normal");
  const dt = d.diskonTambahan;
  // Pratinjau Rupiah sama rumus server (lib/sph-diskon.ts hitungDiskonTambahan).
  const rpBaru = !dt ? 0 : dt.tipe === "persen" ? Math.round((d.total.nett * (Math.round(nilai * 100) / 100)) / 100) : Math.round(nilai);
  const naik = !!dt && rpBaru > dt.rp;
  const salahNilai = !Number.isFinite(nilai) || nilai < 0 || (dt?.tipe === "persen" && nilai >= 100) || naik;
  return (
    <Dialog open onOpenChange={(v) => !v && !sibuk && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Tinjau pengecualian diskon</DialogTitle>
          <DialogDescription>
            SPH untuk {d.customerName ?? "customer"} · total {rupiah(d.total.ppn)} · diskon efektif {persenTeks(d.diskonEfektifTotal)}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <ul className="space-y-2">
            {pengecualian.map((it) => (
              <li key={it.id} className="bg-card rounded-lg border p-2.5 text-sm shadow-[var(--shadow-card)]">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="min-w-0 font-medium break-words">{it.nama}</span>
                  <TierBadge tier={it.tier} />
                </div>
                <p className="text-muted-foreground mt-1 text-xs">
                  Diskon {persenTeks(it.diskonRequested)} · batas {persenTeks(it.diskonMaksSnapshot)} · {it.qty.toLocaleString("id-ID")} ×{" "}
                  {rupiah(it.hargaNett)}
                </p>
              </li>
            ))}
            {dt && (
              <li className="bg-card rounded-lg border p-2.5 text-sm shadow-[var(--shadow-card)]">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="font-medium">
                    Diskon tambahan {dt.tipe === "persen" ? `${dt.nilai}% ` : ""}({rupiah(dt.rp)})
                  </span>
                  <TierBadge tier={d.diskonTambahanTier} />
                </div>
                {d.diskonTambahanAlasan && <p className="text-muted-foreground mt-1 text-xs">{d.diskonTambahanAlasan}</p>}
                {!ubah ? (
                  <Button size="sm" variant="soft" className="mt-2" onClick={() => setUbah(true)} disabled={sibuk}>
                    Turunkan diskon tambahan
                  </Button>
                ) : (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <div className="w-36">
                      <Label htmlFor="rv-dt" className="mb-1 block text-xs">
                        {dt.tipe === "persen" ? "Diskon baru (%)" : "Potongan baru (Rp)"}
                      </Label>
                      <Input
                        id="rv-dt"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        className="h-8 tabular-nums"
                        value={Number.isNaN(nilai) ? "" : nilai}
                        aria-invalid={salahNilai}
                        onChange={(e) => setNilai(e.target.value === "" ? 0 : Number(e.target.value))}
                      />
                    </div>
                    <p className="pb-1.5 text-xs tabular-nums">= {rupiah(rpBaru)}</p>
                    {naik && <p className="text-destructive w-full text-xs">Hanya boleh diturunkan, tidak dinaikkan.</p>}
                  </div>
                )}
              </li>
            )}
          </ul>
          {d.tier === "direktur" && (
            <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-700 dark:bg-red-950/60 dark:text-red-100">
              Setelah Anda setujui, SPH masih perlu persetujuan Direktur sebelum approve & penomoran (kecuali diskon tambahan diturunkan
              hingga tak lagi butuh Direktur).
            </p>
          )}
          <label className="bg-card flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm shadow-[var(--shadow-card)]">
            <Checkbox checked={setuju} onCheckedChange={(v: boolean) => setSetuju(v)} className="mt-0.5" aria-label="Setujui pengecualian diskon" />
            <span>Saya menyetujui pengecualian diskon di atas sebagai HoD Business.</span>
          </label>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sibuk}>
            Batal
          </Button>
          <Button
            disabled={sibuk || !setuju || (ubah && salahNilai)}
            onClick={() => onSubmit(ubah && dt ? (nilai > 0 ? { tipe: dt.tipe, nilai } : null) : undefined)}
          >
            {sibuk ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Setujui review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
