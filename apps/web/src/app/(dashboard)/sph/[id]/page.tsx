"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SkeletonCardGrid } from "@/components/ui/loading";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// F15 — detail SPH: item, Syarat & Ketentuan (bisa diubah selama draft /
// hod_review), penanda tangan (dipilih saat finalisasi, bisa diganti sebelum
// dikirim), dan tombol Cetak/Unduh PDF resmi (apps/api repo/sph-pdf.ts).
// Semua aturan (status, izin edit, larangan pembuat) ditegakkan server; layar
// ini hanya menampilkan pesan penolakannya.

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
}

interface SphDetail {
  id: string;
  customerName: string | null;
  status: string;
  nomorDokumen: string | null;
  approvedBy: string | null;
  hodReviewedBy: string | null;
  syarat: Syarat;
  penandaTangan: { nama: string; jabatan: string | null } | null;
  penandaTanganUserId: string | null;
  items: SphItem[];
  total: { priceList: number; nett: number; ppn: number };
}

interface Kandidat {
  userId: string;
  nama: string;
  jabatan: string | null;
  peran: string[];
}

const LABEL: Record<keyof Syarat, string> = {
  pembayaran: "Pembayaran",
  pengiriman: "Pengiriman",
  masaBerlaku: "Masa berlaku",
  harga: "Harga",
};
const KUNCI = Object.keys(LABEL) as (keyof Syarat)[];

const PERAN: Record<string, string> = {
  approver: "Anda (approver)",
  hod_review: "HoD Business peninjau",
  pembuat: "AM pembuat",
};

const STATUS_BADGE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "secondary",
  hod_review: "secondary",
  approved: "default",
  sent: "outline",
  canceled: "destructive",
};

const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

export default function SphDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<SphDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syarat, setSyarat] = useState<Syarat | null>(null);
  const [kandidat, setKandidat] = useState<Kandidat[]>([]);
  const [ttdId, setTtdId] = useState("");
  const [jabatan, setJabatan] = useState("");

  const muat = useCallback(async () => {
    const res = await fetch(`/api/sph/${encodeURIComponent(id)}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "gagal memuat SPH");
    return data as SphDetail;
  }, [id]);

  const terapkan = useCallback((x: SphDetail) => {
    setD(x);
    setSyarat(x.syarat);
  }, []);

  useEffect(() => {
    let aktif = true;
    (async () => {
      try {
        const x = await muat();
        if (!aktif) return;
        terapkan(x);
        if (x.status === "hod_review" || x.status === "approved") {
          const r = await fetch(`/api/sph/${encodeURIComponent(id)}/penanda-tangan`, { cache: "no-store" });
          const k = await r.json();
          if (!aktif || !r.ok) return;
          const list: Kandidat[] = k.kandidat ?? [];
          setKandidat(list);
          // Default: penanda tangan tersimpan → approver (diri sendiri) → pertama.
          const awal =
            list.find((c) => c.userId === x.penandaTanganUserId) ??
            list.find((c) => c.peran.includes("approver")) ??
            list[0];
          if (awal) {
            setTtdId(awal.userId);
            setJabatan(
              awal.userId === x.penandaTanganUserId ? x.penandaTangan?.jabatan ?? awal.jabatan ?? "" : awal.jabatan ?? "",
            );
          }
        }
      } catch (e) {
        if (aktif) setError(String(e));
      }
    })();
    return () => {
      aktif = false;
    };
  }, [id, muat, terapkan]);

  async function kirim(path: string, method: "PUT" | "POST", body: unknown, sukses: string) {
    setBusy(true);
    setError(null);
    setPesan(null);
    try {
      const res = await fetch(path, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal menyimpan");
      terapkan(await muat());
      setPesan(data.nomor ? `${sukses} Nomor: ${data.nomor}` : sukses);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (error && !d) return <p className="text-destructive p-6 text-sm">{error}</p>;
  if (!d || !syarat) {
    return (
      <div className="p-6">
        <SkeletonCardGrid count={2} />
      </div>
    );
  }

  const syaratBisaDiubah = d.status === "draft" || d.status === "hod_review";
  const ttdBisaDipilih = d.status === "hod_review" || d.status === "approved";
  const variantPending = d.items.filter((it) => !it.variantConfirmed).length;
  const pilih = kandidat.find((k) => k.userId === ttdId);
  const adaDiskon = d.items.some((it) => it.diskonRequested > 0);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">SPH — {d.customerName ?? "-"}</h1>
          <p className="text-muted-foreground text-sm">
            {d.nomorDokumen ? `Nomor ${d.nomorDokumen}` : "DRAF — belum bernomor (nomor diberikan saat finalisasi)"}
            {d.hodReviewedBy ? ` · review HoD: ${d.hodReviewedBy}` : ""}
            {d.approvedBy ? ` · disetujui: ${d.approvedBy}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={STATUS_BADGE[d.status] ?? "secondary"}>{d.status}</Badge>
          <a href={`/api/sph/${encodeURIComponent(d.id)}/pdf`} target="_blank" rel="noopener noreferrer">
            <Button size="sm">Cetak / Unduh PDF</Button>
          </a>
          <Link href="/sales-docs">
            <Button size="sm" variant="outline">
              Sales Docs
            </Button>
          </Link>
        </div>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}
      {pesan && <p className="text-sm text-emerald-700 dark:text-emerald-400">{pesan}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Item ({d.items.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produk</TableHead>
                <TableHead>Satuan</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Harga Satuan</TableHead>
                {adaDiskon && <TableHead className="text-right">Diskon</TableHead>}
                <TableHead className="text-right">Jumlah</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell>
                    {it.nama}
                    {!it.variantConfirmed && <span className="text-amber-600"> · varian belum dikonfirmasi</span>}
                  </TableCell>
                  <TableCell>{it.kemasan ?? "-"}</TableCell>
                  <TableCell className="text-right">{it.qty.toLocaleString("id-ID")}</TableCell>
                  <TableCell className="text-right">{rupiah(adaDiskon ? it.priceList : it.hargaNett)}</TableCell>
                  {adaDiskon && (
                    <TableCell className="text-right">
                      {it.diskonRequested > 0 ? `${Math.round(it.diskonRequested * 10000) / 100}%` : "-"}
                    </TableCell>
                  )}
                  <TableCell className="text-right">{rupiah(it.hargaNett * it.qty)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex flex-wrap justify-end gap-6 text-sm">
            <div>
              Subtotal: <span className="font-medium">{rupiah(d.total.nett)}</span>
            </div>
            <div>
              PPN 11%: <span className="font-medium">{rupiah(d.total.ppn - d.total.nett)}</span>
            </div>
            <div>
              Total: <span className="font-semibold">{rupiah(d.total.ppn)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Syarat & Ketentuan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {syaratBisaDiubah ? (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                {KUNCI.map((k) => (
                  <div key={k}>
                    <Label htmlFor={`syarat-${k}`} className="mb-1 block text-xs">
                      {LABEL[k]}
                    </Label>
                    <Input
                      id={`syarat-${k}`}
                      value={syarat[k]}
                      maxLength={300}
                      onChange={(e) => setSyarat({ ...syarat, [k]: e.target.value })}
                    />
                  </div>
                ))}
              </div>
              <p className="text-muted-foreground text-xs">
                Bisa diubah selama draft / review HoD. Terkunci setelah SPH difinalisasi.
              </p>
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void kirim(`/api/sph/${encodeURIComponent(d.id)}/syarat`, "PUT", syarat, "Syarat tersimpan.")
                }
              >
                Simpan syarat
              </Button>
            </>
          ) : (
            <dl className="grid gap-1 text-sm md:grid-cols-[10rem_1fr]">
              {KUNCI.map((k) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{LABEL[k]}</dt>
                  <dd>{d.syarat[k]}</dd>
                </div>
              ))}
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Penanda Tangan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            {d.penandaTangan ? (
              <>
                Tersimpan: <span className="font-medium">{d.penandaTangan.nama}</span>
                {d.penandaTangan.jabatan ? ` — ${d.penandaTangan.jabatan}` : ""}
              </>
            ) : (
              <span className="text-muted-foreground">Belum dipilih — default: approver tahap 2.</span>
            )}
          </p>
          {ttdBisaDipilih && kandidat.length > 0 && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-64 flex-1">
                <Label htmlFor="sph-ttd" className="mb-1 block text-xs">
                  Pilih penanda tangan
                </Label>
                <select
                  id="sph-ttd"
                  className="border-input focus-visible:border-primary h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm outline-none"
                  value={ttdId}
                  onChange={(e) => {
                    setTtdId(e.target.value);
                    setJabatan(kandidat.find((k) => k.userId === e.target.value)?.jabatan ?? "");
                  }}
                >
                  {kandidat.map((k) => (
                    <option key={k.userId} value={k.userId}>
                      {k.nama}
                      {k.peran.length ? ` — ${k.peran.map((p) => PERAN[p] ?? p).join(", ")}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-56 flex-1">
                <Label htmlFor="sph-jabatan" className="mb-1 block text-xs">
                  Jabatan (dicetak di bawah nama)
                </Label>
                <Input
                  id="sph-jabatan"
                  value={jabatan}
                  maxLength={100}
                  placeholder={pilih?.jabatan ?? "mis. Manajer Penjualan"}
                  onChange={(e) => setJabatan(e.target.value)}
                />
              </div>
            </div>
          )}
          {d.status === "hod_review" && (
            <div className="space-y-2">
              {variantPending > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {variantPending} item nama-varian-kembar belum dikonfirmasi — konfirmasi dulu di halaman Sales Docs.
                </p>
              )}
              <Button
                size="sm"
                disabled={busy || variantPending > 0}
                onClick={() =>
                  void kirim(
                    `/api/sales/docs/${encodeURIComponent(d.id)}/approve`,
                    "POST",
                    { penanda_tangan_user_id: ttdId || undefined, penanda_tangan_jabatan: jabatan },
                    "SPH difinalisasi.",
                  )
                }
              >
                Finalisasi (Approve) & beri nomor
              </Button>
            </div>
          )}
          {d.status === "approved" && kandidat.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !ttdId}
              onClick={() =>
                void kirim(
                  `/api/sph/${encodeURIComponent(d.id)}/penanda-tangan`,
                  "PUT",
                  { user_id: ttdId, jabatan },
                  "Penanda tangan tersimpan.",
                )
              }
            >
              Simpan penanda tangan
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
