"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Gauge, Lock, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { httpErrorMessage } from "@/lib/http-error";

import { periodeLabel, type BarisEffort } from "./insentif-format";

// Panel Effort & Presales (migrasi 184).
//
// Kenapa ini layak satu panel sendiri: keduanya masuk pengali sebagai
// (Effort + Presales)/100, jadi dua AM dengan penjualan identik bisa berbeda insentif
// hampir dua kali lipat hanya karena angka di sini. Sebelum ada tabelnya, angka itu
// cuma bisa dititipkan di badan request hitung ulang — siapa pun yang lupa
// menyertakannya menurunkan insentif semua AM ke default 60/0 tanpa jejak.
//
// Menyimpan = langsung hitung ulang periode AM itu (server). Jadi yang tampil di tabel
// rekap selalu angka yang benar-benar dipakai, bukan niat yang belum diterapkan.

export function InsentifEffortPanel({
  periode,
  baris,
  bisaHitungUlang,
}: {
  periode: string;
  baris: BarisEffort[];
  /** admin/superuser — tombol hitung ulang seluruh periode. */
  bisaHitungUlang: boolean;
}) {
  const router = useRouter();
  const [draf, setDraf] = useState<Record<string, { effort: string; presales: string }>>({});
  const [sibuk, setSibuk] = useState<string | null>(null);
  const [pesan, setPesan] = useState<{ nada: "ok" | "err"; teks: string } | null>(null);

  if (baris.length === 0) return null;

  const nilai = (b: BarisEffort, k: "effort" | "presales") =>
    draf[b.am_id]?.[k] ?? (b[k] == null ? "" : String(b[k]));

  const ubah = (amId: string, k: "effort" | "presales", v: string) =>
    setDraf((d) => ({
      ...d,
      [amId]: {
        effort: k === "effort" ? v : (d[amId]?.effort ?? ""),
        presales: k === "presales" ? v : (d[amId]?.presales ?? ""),
      },
    }));

  async function simpan(b: BarisEffort) {
    const effort = Number(nilai(b, "effort"));
    const presales = Number(nilai(b, "presales") || 0);
    if (!Number.isFinite(effort)) {
      setPesan({ nada: "err", teks: `${b.nama}: Effort harus angka.` });
      return;
    }
    setSibuk(b.am_id);
    setPesan(null);
    try {
      const res = await fetch(`/api/insentif/effort?periode=${encodeURIComponent(periode)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ am_id: b.am_id, effort, presales }),
      });
      if (!res.ok) {
        setPesan({ nada: "err", teks: await httpErrorMessage(res, "gagal menyimpan") });
        return;
      }
      const j = (await res.json()) as { laporan?: { transaksi?: number } };
      setPesan({
        nada: "ok",
        teks: `${b.nama}: tersimpan, ${j.laporan?.transaksi ?? 0} transaksi dihitung ulang.`,
      });
      // Draf baris ini dibuang supaya nilai yang tampil kembali bersumber dari server.
      setDraf((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== b.am_id)));
      router.refresh();
    } catch {
      setPesan({ nada: "err", teks: "jaringan gagal" });
    } finally {
      setSibuk(null);
    }
  }

  async function hitungUlangSemua() {
    setSibuk("__semua__");
    setPesan(null);
    try {
      const res = await fetch(`/api/insentif/compute?periode=${encodeURIComponent(periode)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apply: true }),
      });
      if (!res.ok) {
        setPesan({ nada: "err", teks: await httpErrorMessage(res, "gagal menghitung ulang") });
        return;
      }
      const j = (await res.json()) as {
        transaksi?: number; am_dihitung?: number; am_terkunci?: string[];
        tanpa_hpp?: number; tanpa_aging?: number;
      };
      // Angka "tidak diketahui" ikut dilaporkan: hitung ulang yang sukses tapi 90%
      // fakturnya tanpa aging bukan kabar baik, dan itu tak terlihat dari totalnya.
      setPesan({
        nada: "ok",
        teks:
          `${j.am_dihitung ?? 0} AM · ${j.transaksi ?? 0} transaksi` +
          (j.tanpa_hpp ? ` · ${j.tanpa_hpp} tanpa HPP (MR 0)` : "") +
          (j.tanpa_aging ? ` · ${j.tanpa_aging} tanpa umur lunas (CF 1,00)` : "") +
          (j.am_terkunci?.length ? ` · ${j.am_terkunci.length} AM dilewati (sudah lewat review)` : ""),
      });
      router.refresh();
    } catch {
      setPesan({ nada: "err", teks: "jaringan gagal" });
    } finally {
      setSibuk(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="size-4" /> Effort &amp; Presales · {periodeLabel(periode)}
        </CardTitle>
        {bisaHitungUlang ? (
          <Button
            size="sm"
            variant="outline"
            disabled={sibuk !== null}
            onClick={() => void hitungUlangSemua()}
          >
            <RefreshCw className="size-4" /> Hitung ulang periode
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {pesan ? (
          <p className={pesan.nada === "err" ? "text-destructive text-sm" : "text-sm"}>{pesan.teks}</p>
        ) : null}

        <div className="w-full overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>AM</TableHead>
                <TableHead className="w-[120px]">Effort (0-100)</TableHead>
                <TableHead className="w-[120px]">Presales (0-10)</TableHead>
                <TableHead>Terakhir disetel</TableHead>
                <TableHead className="w-[100px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {baris.map((b) => (
                <TableRow key={b.am_id}>
                  <TableCell className="font-medium whitespace-nowrap">
                    {b.nama}
                    {b.effort == null ? (
                      <Badge variant="outline" className="ml-2" title="Belum disetel — perhitungan memakai 60/0">
                        default 60/0
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number" min={0} max={100} step={1}
                      value={nilai(b, "effort")}
                      disabled={b.terkunci || sibuk !== null}
                      onChange={(e) => ubah(b.am_id, "effort", e.target.value)}
                      aria-label={`Effort ${b.nama}`}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number" min={0} max={10} step={1}
                      value={nilai(b, "presales")}
                      disabled={b.terkunci || sibuk !== null}
                      onChange={(e) => ubah(b.am_id, "presales", e.target.value)}
                      aria-label={`Presales ${b.nama}`}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                    {b.terkunci ? (
                      <span className="flex items-center gap-1">
                        <Lock className="size-3" /> terkunci ({b.status})
                      </span>
                    ) : b.updated_at ? (
                      new Date(b.updated_at).toLocaleDateString("id-ID", {
                        day: "numeric", month: "short", year: "numeric",
                      })
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={b.terkunci || sibuk !== null || !draf[b.am_id]}
                      onClick={() => void simpan(b)}
                    >
                      Simpan
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <p className="text-muted-foreground text-xs leading-relaxed">
          Effort &amp; Presales berlaku global per AM per bulan dan masuk ke pengali sebagai{" "}
          <span className="font-mono">(Effort + Presales) / 100</span>. Menyimpan langsung
          menghitung ulang periode AM tersebut. Baris terkunci berarti rekapnya sudah lewat
          tahap review — angka yang sudah diverifikasi tidak diubah dari sini.
        </p>
      </CardContent>
    </Card>
  );
}
