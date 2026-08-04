"use client";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ItTicketsTable, type ItTicket } from "@/components/tables/it-tickets-table";
import { AddItTicketButton } from "@/components/crm/add-it-ticket-button";

// F52 — tiket masalah per aset. Sebelumnya 1 halaman 2 tab (Tiket + Aset);
// tab Aset DIHAPUS setelah F52 diserap F132 (arahan Direktur) — master aset
// (termasuk aset IT) sekarang dikelola di /ga-aset, single source of truth
// SEMUA aset kantor, bukan cuma IT. Picker "Buat Tiket" fetch dari sana.
export function ItAssetView({ tickets, assets }: { tickets: ItTicket[] | null; assets: { id: string; asset_code: string; nama: string; is_critical: boolean; active: boolean }[] }) {
  // Picker cuma boleh nawarin aset AKTIF — backend menolak ticket ke aset
  // nonaktif, jadi jangan sodorkan pilihan yg pasti ditolak.
  const activeAssets = assets.filter((a) => a.active);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <AddItTicketButton assets={activeAssets} />
      </div>
      <Card>
        <CardContent className="pt-6">
          {!tickets ? (
            <EmptyState title="Data tidak tersedia" description="Pastikan apps/api jalan & DATABASE_URL terisi." />
          ) : tickets.length === 0 ? (
            <EmptyState
              title="Belum ada tiket"
              description={activeAssets.length === 0 ? 'Belum ada aset aktif — tambah dulu di menu "Aset GA".' : 'Klik "Buat Tiket" untuk mulai.'}
            />
          ) : (
            <ItTicketsTable tickets={tickets} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
