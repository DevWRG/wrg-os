"use client";

// F169 — Riwayat Alat di dialog detail faskes Produktivitas KSO (migrasi 217).
// BACA-SAJA: mencatat pindah/tarik ada di menu Daftar Alat dan hanya untuk
// teknisi (keputusan user 13 Okt 2026) — lihat mutasi-alat-dialog.tsx.
//
// Faskes-minded: satu faskes menampilkan SEMUA alat yang pernah berada di sana,
// termasuk yang sudah pindah, lengkap dengan dari mana alat datang dan ke mana
// pergi. Tes per baris = tes laporan teknisi selama alat di lokasi itu, sehingga
// faskes lama tetap memegang riwayatnya sendiri.

import { useEffect, useState } from "react";
import { History } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { BarisPenempatan, type Penempatan } from "./penempatan-shared";

export function RiwayatAlat({ accountId }: { accountId: number }) {
  const [hasil, setHasil] = useState<{ accountId: number; rows: Penempatan[] | null; galat: boolean } | null>(null);

  useEffect(() => {
    let batal = false;
    fetch(`/api/kso/penempatan/faskes/${accountId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { rows: Penempatan[] }) => { if (!batal) setHasil({ accountId, rows: j.rows, galat: false }); })
      .catch(() => { if (!batal) setHasil({ accountId, rows: null, galat: true }); });
    return () => { batal = true; };
  }, [accountId]);

  // Hasil milik faskes lain (dialog berganti faskes) dianggap belum siap.
  const siap = hasil?.accountId === accountId ? hasil : null;
  if (!siap) return <Skeleton className="h-24 w-full motion-reduce:animate-none" />;

  const perAlat = new Map<number, Penempatan[]>();
  for (const p of siap.rows ?? []) perAlat.set(p.assetId, [...(perAlat.get(p.assetId) ?? []), p]);
  const adaPindah = [...perAlat.values()].some((ps) => ps.length > 1);

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium">
        <History className="size-3.5" /> Riwayat alat ({perAlat.size})
      </div>
      {siap.galat ? <p className="mb-2 text-xs text-red-600">Riwayat alat gagal dimuat.</p> : null}
      {!adaPindah && perAlat.size ? (
        <p className="text-muted-foreground mb-2 text-[11px]">
          Belum ada alat yang tercatat pindah masuk/keluar faskes ini.
        </p>
      ) : null}
      <div className="space-y-2">
        {[...perAlat.entries()].map(([assetId, ps]) => (
          <div key={assetId} className="border-border rounded-lg border p-2.5">
            <div className="text-xs">
              <span className="font-medium">{ps[0].namaAlat ?? ps[0].typeAlat ?? "—"}</span>
              <span className="text-muted-foreground"> · SN {ps[0].snRaw ?? ps[0].snKey}</span>
            </div>
            <ol className="mt-1.5 space-y-1">
              {ps.map((p) => <BarisPenempatan key={p.id} p={p} sorot={p.accountId === accountId} />)}
            </ol>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground mt-2 text-[11px]">
        Perpindahan alat dicatat teknisi di menu Daftar Alat. Tes bulan pindah ikut lokasi dengan
        hari terbanyak di bulan itu; revenue tidak perlu dipindah — faktur Accurate memang terbit
        atas nama faskes.
      </p>
    </div>
  );
}
