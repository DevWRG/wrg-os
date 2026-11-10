"use client";

import type { ReactNode } from "react";

import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { CardPagination, usePagedList } from "@/components/ui/card-pagination";

/** Sama dengan pilihan Baris/hal DataTable. */
export const TABLE_PAGE_SIZES = [10, 25, 50, 100];

/**
 * Tabel biasa (<Table>) yang dipaginasi 10 baris/hal — untuk tabel dengan baris custom
 * (tombol, form, kolom gabungan) yang tidak cocok dipindah ke DataTable. Baris dirender
 * pemanggil (`rows`, sudah ber-key); komponen ini hanya memotong per halaman dan menaruh
 * footer Prev/Next yang sama idiomnya dengan DataTable. Datanya harus sudah utuh di
 * browser — `total` = jumlah baris yang dikirim, bukan yang sedang dirender.
 */
export function PagedTable({
  header,
  rows,
  empty,
  colSpan,
  label = "baris",
  resetKey = "",
}: {
  header: ReactNode;
  rows: ReactNode[];
  /** Isi sel saat rows kosong (butuh colSpan). */
  empty?: ReactNode;
  colSpan?: number;
  label?: string;
  /** Tanda tangan filter aktif: berubah → kembali ke halaman 1. */
  resetKey?: string;
}) {
  const { visible, page, pageSize, setPage, setPageSize } = usePagedList(rows, resetKey, TABLE_PAGE_SIZES[0]);
  return (
    <div className="space-y-3">
      <Table>
        {header}
        <TableBody>
          {rows.length === 0 && empty != null ? (
            <TableRow>
              <TableCell colSpan={colSpan} className="text-muted-foreground text-center text-sm">{empty}</TableCell>
            </TableRow>
          ) : visible}
        </TableBody>
      </Table>
      <CardPagination
        total={rows.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize}
        label={label} sizes={TABLE_PAGE_SIZES} perLabel="Baris/hal:"
      />
    </div>
  );
}
