"use client";

import { useMemo, useState } from "react";

/** Kelipatan 12 supaya baris grid 2/3 kolom tetap penuh di halaman terakhir. */
export const CARD_PAGE_SIZES = [12, 24, 48, 96];

/**
 * Paginasi untuk grid KARTU (bukan tabel). Footer & istilahnya sengaja meniru
 * DataTable supaya satu idiom: "Kartu/hal", "Hal x/y", Prev/Next.
 *
 * Pemotongan murni di klien karena datanya memang sudah utuh di browser (tab
 * Churn & Win-back mengirim seluruh daftar sekaligus), jadi bukan pola "backend
 * limit + hitung di klien" yang bikin angka bohong — `total` di sini selalu
 * jumlah baris hasil filter, bukan yang sedang dirender.
 */
export function CardPagination({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  label = "pelanggan",
}: {
  /** Jumlah item hasil filter (bukan jumlah yang dirender di halaman ini). */
  total: number;
  /** Halaman aktif, berbasis 0 (sudah di-clamp oleh pemanggil via usePagedList). */
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  label?: string;
}) {
  if (total <= CARD_PAGE_SIZES[0]) return null;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(page, pageCount - 1);
  const from = cur * pageSize + 1;
  const to = Math.min(total, (cur + 1) * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground text-xs">
        {from}–{to} dari {total} {label}
      </span>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">Kartu/hal:</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="h-7 rounded-md border border-input bg-transparent px-1.5 text-sm outline-none"
          >
            {CARD_PAGE_SIZES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">Hal {cur + 1}/{pageCount}</span>
          <button
            type="button"
            onClick={() => onPageChange(Math.max(0, cur - 1))}
            disabled={cur === 0}
            className="rounded-md border px-2 py-1 text-xs disabled:opacity-40 hover:bg-muted"
          >
            Prev
          </button>
          <button
            type="button"
            onClick={() => onPageChange(Math.min(pageCount - 1, cur + 1))}
            disabled={cur >= pageCount - 1}
            className="rounded-md border px-2 py-1 text-xs disabled:opacity-40 hover:bg-muted"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * State paginasi + potongan halaman untuk grid kartu.
 *
 * `resetKey` = tanda tangan filter aktif (mis. `${tier}|${am}|${q}`): tiap kali
 * filter berubah halaman balik ke 1, kalau tidak hasil filter baru bisa tampak
 * KOSONG cuma karena kita masih berdiri di halaman 7.
 */
export function usePagedList<T>(items: T[], resetKey: string, initialSize = 24) {
  const [pageSize, setPageSize] = useState(initialSize);
  // Halaman disimpan BERSAMA tanda tangan filternya: begitu filter (atau ukuran
  // halaman) berubah, nilai tersimpan kedaluwarsa dan kita balik ke halaman 1
  // sendirinya — tanpa useEffect setState yang memicu render bertingkat.
  const key = `${resetKey}|${pageSize}`;
  const [pos, setPos] = useState({ key, page: 0 });

  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const cur = Math.min(pos.key === key ? pos.page : 0, pageCount - 1);
  const visible = useMemo(() => items.slice(cur * pageSize, cur * pageSize + pageSize), [items, cur, pageSize]);

  return { visible, page: cur, pageSize, setPage: (p: number) => setPos({ key, page: p }), setPageSize };
}
