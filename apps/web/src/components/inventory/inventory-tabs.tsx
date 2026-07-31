"use client";

import { useState } from "react";

import { InventoryTable, type InventoryItem } from "@/components/tables/inventory-table";
import {
  StockBranchTable,
  type StockBranchRow,
  type WarehouseCol,
} from "@/components/tables/stock-branch-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export interface StockBranchSummary {
  item_mirror: number;
  item_ada_data: number;
  item_tanpa_data: number;
  item_selisih: number;
  item_selisih_negatif: number;
  cakupan_persen: number;
  terakhir_update: string | null;
  per_gudang: {
    kode: string;
    nama: string;
    cabang: string | null;
    aktif: boolean;
    item_count: number;
    total_qty: number;
    terakhir_update: string | null;
  }[];
}

const fmt = (n: number) => new Intl.NumberFormat("id-ID").format(n);
const tglJam = (iso: string | null) =>
  iso == null
    ? "belum pernah"
    : new Date(iso).toLocaleString("id-ID", {
        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
      });

// Ambil maksimal ini per permintaan. Katalog Accurate ~5.800 item, jadi 10.000
// menutup seluruhnya dengan ruang tumbuh — dan kalau suatu hari terlampaui,
// banner "terpotong" di bawah yang memberi tahu, bukan hasil pencarian kosong
// yang menyesatkan.
const LIMIT = 10000;

type Filter = "semua" | "anomali" | "tanpa_data";

interface BranchData {
  rows: StockBranchRow[];
  total_rows: number;
  warehouses: WarehouseCol[];
  summary: StockBranchSummary | null;
  warehousesGagal: boolean;
}

// Satu menu, dua fungsi (F2 + F37):
//   Tab "Semua Stok" — cek stok agregat per SKU dari mirror Accurate. Fungsi yang
//     sudah ada sebelum F37 dan TIDAK diubah.
//   Tab "Per Gudang" — stok tiap gudang cabang + korelasinya ke angka total.
//
// Data tab 2 diambil SAAT TAB DIBUKA, bukan ikut payload halaman: pada katalog
// 5.800 item matriksnya ~1,3 MB, dan tab ini default tertutup — tanpa ini orang
// yang cuma memakai tab 1 menanggung 1,3 MB yang tak pernah dilihatnya.
// `items` null = fetch tab 1 gagal. Tab 2 TIDAK ikut disembunyikan — dulu gate
// itu ada di page.tsx dan mematikan seluruh halaman, padahal /accurate/items
// (10.000 baris) request terberat & paling mungkin timeout.
export function InventoryTabs({ items }: { items: InventoryItem[] | null }) {
  const [tab, setTab] = useState<"semua" | "gudang">("semua");
  const [filter, setFilter] = useState<Filter>("semua");
  // null = belum pernah fetch / sedang memuat. setState HANYA di dalam handler
  // async, tidak sinkron di body effect — hindari react-hooks/set-state-in-effect.
  const [branch, setBranch] = useState<BranchData | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function muat(f: Filter) {
    setBranch(null);
    setError(null);
    const qs =
      f === "anomali" ? `&negatif=1` : f === "tanpa_data" ? `&tanpa_data=1` : "";
    try {
      const [rowsRes, whRes, sumRes] = await Promise.all([
        fetch(`/api/stock/branch?limit=${LIMIT}${qs}`),
        fetch(`/api/stock/warehouses?aktif=1`),
        fetch(`/api/stock/branch/summary`),
      ]);
      if (!rowsRes.ok) throw new Error((await rowsRes.json()).error ?? "gagal memuat stok per gudang");
      const rowsJson = (await rowsRes.json()) as { rows: StockBranchRow[]; total_rows: number };
      // Kegagalan warehouses TIDAK ditelan jadi array kosong: tanpa kolom gudang,
      // Σ Cabang & Selisih tetap tampil dan halaman kelihatan lengkap padahal
      // matriksnya hilang. Ditandai supaya bisa diberitahukan.
      let warehouses: WarehouseCol[] = [];
      let warehousesGagal = true;
      if (whRes.ok) {
        warehouses = ((await whRes.json()) as { warehouses: WarehouseCol[] }).warehouses ?? [];
        warehousesGagal = false;
      }
      const summary = sumRes.ok ? ((await sumRes.json()) as StockBranchSummary) : null;
      setBranch({ rows: rowsJson.rows ?? [], total_rows: rowsJson.total_rows ?? 0, warehouses, summary, warehousesGagal });
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }

  function bukaTab(k: "semua" | "gudang") {
    setTab(k);
    if (k === "gudang" && branch == null && error == null) void muat(filter);
  }

  function gantiFilter(f: Filter) {
    setFilter(f);
    void muat(f);
  }

  const terpotong = branch != null && branch.rows.length < branch.total_rows;

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Tampilan stok" className="flex w-fit gap-1 rounded-lg border p-1">
        {(
          [
            ["semua", "Semua Stok"],
            ["gudang", "Per Gudang"],
          ] as const
        ).map(([k, lbl]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            aria-controls={`panel-${k}`}
            id={`tab-${k}`}
            onClick={() => bukaTab(k)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            {/* Status aktif tidak boleh disampaikan hanya lewat warna. */}
            {tab === k ? <span aria-hidden="true">• </span> : null}
            {lbl}
          </button>
        ))}
      </div>

      {tab === "semua" ? (
        <div role="tabpanel" id="panel-semua" aria-labelledby="tab-semua">
          <Card>
            <CardContent className="pt-6">
              {/* Dua keadaan ini dibedakan sejak sebelum F37, jangan disatukan:
                  API gagal ≠ katalog kosong. */}
              {items == null ? (
                <EmptyState
                  title="Data tidak tersedia"
                  description="Pastikan apps/api jalan & sinkron Accurate aktif."
                />
              ) : items.length === 0 ? (
                <EmptyState title="Belum ada item" description="Jalankan sinkron: POST /accurate/sync/items." />
              ) : (
                <InventoryTable items={items} />
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <div role="tabpanel" id="panel-gudang" aria-labelledby="tab-gudang" className="space-y-4">
          {error ? (
            <Card>
              <CardContent className="pt-6">
                <EmptyState title="Gagal memuat stok per gudang" description={error} />
                <Button size="sm" variant="outline" className="mt-3" onClick={() => void muat(filter)}>
                  Coba lagi
                </Button>
              </CardContent>
            </Card>
          ) : branch == null ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-muted-foreground text-sm">Memuat stok per gudang…</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Kesehatan data DI ATAS tabel: angka per gudang tak layak dipakai
                  memutuskan relokasi barang sebelum pembaca tahu seberapa lengkap
                  datanya. */}
              {branch.summary && (
                <Card>
                  <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <p className="text-muted-foreground text-xs">Cakupan data gudang</p>
                      <p className="text-2xl font-semibold">{branch.summary.cakupan_persen}%</p>
                      <p className="text-muted-foreground text-xs">
                        {fmt(branch.summary.item_ada_data)} dari {fmt(branch.summary.item_mirror)} item
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Belum ada data cabang</p>
                      <p className="text-2xl font-semibold">{fmt(branch.summary.item_tanpa_data)}</p>
                      <p className="text-muted-foreground text-xs">item</p>
                    </div>
                    {/* Dipisah karena artinya berbeda: yang kiri informasional
                        (bisa barang di gudang customer), yang kanan mustahil. */}
                    <div>
                      <p className="text-muted-foreground text-xs">Total &gt; Σ cabang</p>
                      <p className="text-2xl font-semibold">{fmt(branch.summary.item_selisih)}</p>
                      <p className="text-muted-foreground text-xs">wajar bila barang ada di gudang customer</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Σ cabang &gt; total</p>
                      <p className={`text-2xl font-semibold ${branch.summary.item_selisih_negatif > 0 ? "text-danger" : ""}`}>
                        {fmt(branch.summary.item_selisih_negatif)}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {branch.summary.item_selisih_negatif > 0 ? "mustahil — data perlu dicek" : "tidak ada anomali"}
                      </p>
                    </div>
                    <div className="sm:col-span-2 lg:col-span-4">
                      <p className="text-muted-foreground text-xs">
                        Data terakhir masuk:{" "}
                        <span className="font-medium">{tglJam(branch.summary.terakhir_update)}</span>
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {branch.summary && branch.summary.per_gudang.length > 0 && (
                <Card>
                  <CardContent className="pt-6">
                    <p className="mb-3 text-sm font-medium">Ringkasan per gudang cabang</p>
                    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                      {branch.summary.per_gudang.map((w) => (
                        <div key={w.kode} className="rounded-lg border p-3">
                          <p className="text-sm font-medium">
                            {w.kode}
                            {!w.aktif && <span className="text-warning text-xs"> (nonaktif)</span>}
                          </p>
                          <p className="text-muted-foreground text-xs">{w.nama}</p>
                          <p className="mt-2 text-lg font-semibold">{fmt(w.total_qty)}</p>
                          <p className="text-muted-foreground text-xs">
                            {w.item_count === 0 ? "belum ada data" : `${fmt(w.item_count)} item`}
                          </p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardContent className="space-y-3 pt-6">
                  {/* Filter anomali: ringkasan bilang "data perlu dicek", jadi harus
                      ada jalan ke barisnya. Difilter di server (endpoint sudah
                      dukung), bukan di klien, supaya tak perlu mengirim semuanya. */}
                  <div className="flex flex-wrap gap-1">
                    {(
                      [
                        ["semua", "Semua item"],
                        ["anomali", "Hanya anomali (Σ cabang > total)"],
                        ["tanpa_data", "Belum ada data cabang"],
                      ] as const
                    ).map(([k, lbl]) => (
                      <Button
                        key={k}
                        size="sm"
                        variant={filter === k ? "default" : "outline"}
                        onClick={() => gantiFilter(k)}
                      >
                        {lbl}
                      </Button>
                    ))}
                  </div>

                  {branch.warehousesGagal && (
                    <p className="text-danger text-sm">
                      Daftar gudang gagal dimuat, jadi kolom per gudang tidak bisa ditampilkan. Angka Σ
                      Cabang di bawah tetap benar, tapi rinciannya per gudang tidak terlihat — muat ulang
                      halaman sebelum memakai angka ini.
                    </p>
                  )}

                  {terpotong && (
                    <p className="text-warning text-sm">
                      Menampilkan {fmt(branch.rows.length)} dari {fmt(branch.total_rows)} item — daftar
                      terpotong. SKU yang tidak muncul di sini bukan berarti tidak ada; persempit dengan
                      filter di atas.
                    </p>
                  )}

                  {branch.rows.length === 0 ? (
                    <EmptyState
                      title={
                        filter === "anomali"
                          ? "Tidak ada anomali"
                          : filter === "tanpa_data"
                            ? "Semua item sudah punya data cabang"
                            : "Belum ada data stok per gudang"
                      }
                      description={
                        filter === "semua"
                          ? "Isi lewat importer: scripts/db/import_stock_branch.py --file <csv> --db <db> --apply"
                          : "Coba filter lain."
                      }
                    />
                  ) : (
                    <>
                      <StockBranchTable rows={branch.rows} warehouses={branch.warehouses} />
                      <p className="text-muted-foreground text-xs">
                        Kolom gudang: <span className="font-medium">—</span> berarti belum diisi,{" "}
                        <span className="font-medium">0</span> berarti sudah dihitung dan hasilnya habis.
                        Kolom <span className="font-medium">Total − Σ Cabang</span>: nilai positif wajar
                        (barang bisa berada di gudang customer); yang perlu dicek adalah nilai{" "}
                        <span className="font-medium">negatif</span> — stok cabang tak mungkin melebihi
                        total perusahaan.
                      </p>
                      <p className="text-muted-foreground text-xs">
                        Hanya <span className="font-medium">gudang cabang WRG</span> yang ditampilkan.
                        Gudang virtual yang berada di customer sengaja tidak dimasukkan, jadi Σ Cabang di
                        sini bukan seluruh barang yang tercatat di Accurate.
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  );
}
