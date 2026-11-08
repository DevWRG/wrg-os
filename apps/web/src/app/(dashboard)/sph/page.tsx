"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronRight, FilePlus2, FileText, Search, Settings2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusSphBadge, ambilJson, pesanRamah, rupiah, tglPendek, type AksiSph } from "@/components/sph/sph-ui";
import { can } from "@/lib/perms";
import { useSession } from "@/lib/use-session";
import { cn } from "@/lib/utils";

// F15 — Daftar SPH (dulu /sph hanya redirect ke /sph/new). Satu tempat untuk
// melihat semua Surat Penawaran Harga, menyaring per tahap, mencari, dan tahu
// "apa langkah berikutnya untuk saya". Petunjuk aksi dihitung server
// (apps/api lib/sph-alur.ts) dari identitas sesi — layar tidak menebak izin.
// Aksinya sendiri dikerjakan di halaman detail.

interface Baris {
  id: string;
  customerName: string | null;
  status: string;
  nomorDokumen: string | null;
  createdAt: string;
  pembuat: string | null;
  jumlahItem: number;
  variantPending: number;
  total: number;
  aksi: AksiSph;
}

interface Hasil {
  rows: Baris[];
  counts: Record<string, number>;
}

const TAB: { key: string; label: string }[] = [
  { key: "saya", label: "Perlu aksi saya" },
  { key: "semua", label: "Semua" },
  { key: "draft", label: "Menunggu Review" },
  { key: "hod_review", label: "Menunggu Approve" },
  { key: "approved", label: "Disetujui" },
  { key: "sent", label: "Terkirim" },
  { key: "canceled", label: "Dibatalkan" },
];

const KOSONG: Record<string, { judul: string; isi: string }> = {
  saya: { judul: "Tidak ada yang menunggu Anda", isi: "SPH yang perlu Anda review, approve, atau kirim akan muncul di sini." },
  semua: { judul: "Belum ada SPH", isi: "Buat SPH pertama: pilih customer, tambahkan produk dari Price Book, lalu ajukan ke HoD." },
  draft: { judul: "Tak ada SPH yang menunggu review", isi: "SPH baru otomatis masuk ke sini sampai direview HoD Business." },
  hod_review: { judul: "Tak ada SPH yang menunggu approve", isi: "Setelah direview HoD, SPH menunggu approve & nomor surat di sini." },
  approved: { judul: "Tak ada SPH yang siap dikirim", isi: "SPH yang sudah bernomor muncul di sini sampai dikirim ke customer." },
  sent: { judul: "Belum ada SPH terkirim", isi: "SPH yang sudah dikirim lewat WhatsApp ke customer tercatat di sini." },
  canceled: { judul: "Tak ada SPH dibatalkan", isi: "" },
};

const chip = (aktif: boolean) =>
  cn(
    "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
    aktif
      ? "border-primary-dark bg-primary-soft text-foreground dark:border-primary"
      : "bg-card border-border text-muted-foreground shadow-[var(--shadow-card)] hover:text-foreground hover:border-primary/50",
  );

export default function SphListPage() {
  const router = useRouter();
  const me = useSession();
  const bisaBuat = !me?.permissions?.["sales-docs"] || can(me, "sales-docs", "create");
  const [tab, setTab] = useState<string | null>(null); // null = pilih otomatis
  const [q, setQ] = useState("");
  const [cari, setCari] = useState("");
  const [data, setData] = useState<Hasil | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Ketik → cari setelah jeda singkat.
  useEffect(() => {
    const t = window.setTimeout(() => setCari(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const tabAktif = tab ?? "semua";

  useEffect(() => {
    let aktif = true;
    const qs = new URLSearchParams({ status: tabAktif });
    if (cari) qs.set("q", cari);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- penanda muat sebelum fetch; disengaja.
    setLoading(true);
    ambilJson<Hasil>(`/api/sph?${qs.toString()}`)
      .then((d) => {
        if (!aktif) return;
        setData(d);
        setError(null);
        // Buka pertama kali: kalau ada yang menunggu saya, langsung tampilkan itu.
        if (tab === null && !cari && (d.counts.saya ?? 0) > 0) setTab("saya");
      })
      .catch((e) => aktif && setError(pesanRamah(e)))
      .finally(() => aktif && setLoading(false));
    return () => {
      aktif = false;
    };
  }, [tabAktif, cari, tab]);

  const rows = data?.rows ?? [];
  const counts = data?.counts ?? {};
  const kosong = KOSONG[tabAktif] ?? KOSONG.semua;

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Surat Penawaran Harga</h1>
          <p className="text-muted-foreground text-sm">Buat SPH dari Price Book, review HoD, approve & beri nomor, lalu kirim ke customer.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="soft" render={<Link href="/sph/pengaturan" />}>
            <Settings2 /> Pengaturan
          </Button>
          {bisaBuat && (
            <Button render={<Link href="/sph/new" />}>
              <FilePlus2 /> Buat SPH
            </Button>
          )}
        </div>
      </div>

      {/* Alur singkat — supaya pengguna baru tahu tahapannya */}
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <Sparkles className="text-primary size-3.5" />
        <span>Alur:</span>
        {["AM buat SPH", "HoD Business review", "Approve & nomor surat", "Kirim ke customer"].map((s, i, a) => (
          <span key={s} className="inline-flex items-center gap-2">
            <span className="text-foreground">{s}</span>
            {i < a.length - 1 && <ChevronRight className="size-3" />}
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0"
          role="tablist"
          aria-label="Saring status SPH"
        >
          {TAB.map((t) => {
            const n = counts[t.key] ?? 0;
            const aktif = tabAktif === t.key;
            return (
              <button key={t.key} type="button" role="tab" aria-selected={aktif} className={chip(aktif)} onClick={() => setTab(t.key)}>
                {t.label}
                <span
                  className={cn(
                    "min-w-5 rounded-full px-1.5 text-center text-xs tabular-nums",
                    t.key === "saya" && n > 0 ? "bg-primary text-primary-foreground" : "bg-background text-foreground",
                  )}
                >
                  {n}
                </span>
              </button>
            );
          })}
        </div>
        <div className="relative w-full lg:w-72">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari customer atau nomor…" className="bg-card pl-9" aria-label="Cari SPH" />
        </div>
      </div>

      {error && <p className="border-destructive/40 bg-card text-destructive rounded-lg border px-3 py-2 text-sm">{error}</p>}

      <Card className="py-0">
        <CardContent className="p-0">
          {loading && !data ? (
            <div className="space-y-3 p-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={FileText}
              title={cari ? `Tak ada SPH untuk "${cari}"` : kosong.judul}
              description={cari ? "Coba kata kunci lain, atau periksa tab status lain." : kosong.isi}
              action={
                !cari && bisaBuat && (tabAktif === "semua" || tabAktif === "draft") ? (
                  <Button render={<Link href="/sph/new" />}>
                    <FilePlus2 /> Buat SPH
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className={cn(loading && "opacity-60 transition-opacity")}>
              {/* Desktop: tabel */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Customer</TableHead>
                      <TableHead>Nomor</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Langkah berikutnya</TableHead>
                      <TableHead>Dibuat</TableHead>
                      <TableHead className="w-8" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id} className="cursor-pointer" onClick={() => router.push(`/sph/${r.id}`)}>
                        <TableCell className="max-w-72 pl-4">
                          <Link href={`/sph/${r.id}`} className="block truncate font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                            {r.customerName ?? "—"}
                          </Link>
                          <span className="text-muted-foreground text-xs">{r.jumlahItem} item</span>
                        </TableCell>
                        <TableCell>
                          {r.nomorDokumen ? (
                            <span className="font-mono text-xs">{r.nomorDokumen}</span>
                          ) : (
                            <span className="text-muted-foreground rounded border border-dashed px-1.5 py-0.5 text-[11px] font-semibold tracking-wide">
                              DRAF
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{rupiah(r.total)}</TableCell>
                        <TableCell>
                          <StatusSphBadge status={r.status} />
                        </TableCell>
                        <TableCell>
                          <Petunjuk aksi={r.aksi} />
                        </TableCell>
                        <TableCell className="text-xs">
                          <div>{tglPendek(r.createdAt)}</div>
                          <div className="text-muted-foreground max-w-36 truncate">{r.pembuat ?? "—"}</div>
                        </TableCell>
                        <TableCell>
                          <ChevronRight className="text-muted-foreground size-4" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {/* Ponsel: kartu */}
              <ul className="divide-border divide-y md:hidden">
                {rows.map((r) => (
                  <li key={r.id}>
                    <Link href={`/sph/${r.id}`} className="hover:bg-accent/40 flex flex-col gap-2 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{r.customerName ?? "—"}</p>
                          <p className="text-muted-foreground font-mono text-xs">{r.nomorDokumen ?? "DRAF"}</p>
                        </div>
                        <StatusSphBadge status={r.status} />
                      </div>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="font-semibold tabular-nums">{rupiah(r.total)}</span>
                        <span className="text-muted-foreground text-xs">
                          {tglPendek(r.createdAt)} · {r.jumlahItem} item
                        </span>
                      </div>
                      <Petunjuk aksi={r.aksi} />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
      {rows.length >= 200 && (
        <p className="text-muted-foreground text-xs">Menampilkan 200 SPH terbaru — gunakan pencarian untuk yang lebih lama.</p>
      )}
    </div>
  );
}

function Petunjuk({ aksi }: { aksi: AksiSph }) {
  if (aksi.perluAksiSaya) {
    return (
      <span className="text-primary-dark dark:text-primary inline-flex items-center gap-1.5 text-xs font-semibold">
        <span className="bg-primary size-1.5 rounded-full" aria-hidden />
        {aksi.petunjuk}
      </span>
    );
  }
  return <span className="text-muted-foreground text-xs">{aksi.petunjuk}</span>;
}
