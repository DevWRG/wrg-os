"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Send } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { deriveRow, formatPercent, formatRupiah, num, type PricelistRow } from "@/lib/pricelist";
import { PricelistFormDialog, type ProductOption } from "@/components/pricelist/pricelist-form-sheet";

export function SetupPricelistClient({
  rows,
  products,
  canPublish,
}: {
  rows: PricelistRow[];
  products: ProductOption[];
  canPublish: boolean;
}) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<PricelistRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmPublishAll, setConfirmPublishAll] = useState(false);

  const draftCount = rows.filter((r) => r.status === "draft").length;
  const money = (v: string | number | null) => formatRupiah(num(v));

  async function publishAll() {
    setBusy(true);
    try {
      const res = await fetch("/api/pricelist/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error ?? "Gagal publish");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // Kolom ringkas agar muat tanpa scroll horizontal; detail lengkap (insentif,
  // loyalty, konfirmasi area) dibuka lewat klik baris.
  const columns: DataColumn<PricelistRow>[] = [
    { id: "no", header: "SKU", sortable: true, accessor: (r) => r.product_no ?? "", cell: (r) => <span className="font-medium whitespace-nowrap">{r.product_no ?? "—"}</span> },
    { id: "name", header: "Nama Produk", sortable: true, accessor: (r) => r.product_name ?? "", cell: (r) => <span className="block max-w-[22rem] truncate" title={r.product_name ?? ""}>{r.product_name ?? "—"}</span>, className: "max-w-[22rem]" },
    { id: "hpp", header: "Harga Principal", align: "right", sortable: true, accessor: (r) => num(r.hpp), cell: (r) => <span className="whitespace-nowrap">{money(r.hpp)}</span> },
    { id: "margin", header: "Margin", align: "right", sortable: true, accessor: (r) => num(r.margin_pct), cell: (r) => <span className="whitespace-nowrap">{formatPercent(num(r.margin_pct))}</span> },
    { id: "pl", header: "Price List", align: "right", sortable: true, accessor: (r) => deriveRow(r).priceList, cell: (r) => <span className="whitespace-nowrap">{formatRupiah(deriveRow(r).priceList)}</span> },
    { id: "diskon", header: "Diskon", align: "right", sortable: true, accessor: (r) => num(r.diskon_pct), cell: (r) => <span className="whitespace-nowrap">{formatPercent(num(r.diskon_pct))}</span> },
    { id: "nett", header: "Nett Price", align: "right", sortable: true, accessor: (r) => deriveRow(r).nettPrice, cell: (r) => <span className="whitespace-nowrap">{formatRupiah(deriveRow(r).nettPrice)}</span> },
    { id: "ppn", header: "Price + PPN", align: "right", sortable: true, accessor: (r) => deriveRow(r).pricePpn, cell: (r) => <span className="font-medium whitespace-nowrap">{formatRupiah(deriveRow(r).pricePpn)}</span> },
    { id: "status", header: "Status", sortable: true, accessor: (r) => r.status, cell: (r) => <Badge variant={r.status === "published" ? "secondary" : "outline"}>{r.status === "published" ? "Published" : "Draft"}</Badge> },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        getKey={(r) => r.id}
        searchPlaceholder="Cari SKU / nama produk…"
        pageSize={25}
        empty="Belum ada pricelist. Tambah lewat tombol di kanan atas."
        onRowClick={(r) => { setEditing(r); setSheetOpen(true); }}
        toolbar={
          <>
            {canPublish && (
              <Button size="sm" variant="outline" onClick={() => setConfirmPublishAll(true)} disabled={busy || draftCount === 0}>
                <Send /> Publish Semua{draftCount > 0 ? ` (${draftCount})` : ""}
              </Button>
            )}
            <Button size="sm" onClick={() => { setEditing(null); setSheetOpen(true); }}>
              <Plus /> Tambah Pricelist
            </Button>
          </>
        }
      />
      <p className="text-muted-foreground mt-2 text-xs">Klik baris untuk melihat detail & mengedit.</p>

      <PricelistFormDialog
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        products={products}
        initial={editing}
        canPublish={canPublish}
        onSaved={() => router.refresh()}
      />

      <ConfirmDialog
        open={confirmPublishAll}
        onOpenChange={setConfirmPublishAll}
        title="Publish semua draft?"
        description={`Semua ${draftCount} draft akan langsung tampil ke Account Manager.`}
        confirmLabel="Publish Semua"
        onConfirm={() => void publishAll()}
      />
    </>
  );
}
