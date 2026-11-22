"use client";

import { useRouter } from "next/navigation";

import { StockBranchTable, type StockBranchRow, type StockQuery, type WarehouseCol } from "@/components/tables/stock-branch-table";
import { useTableUrl } from "@/lib/use-table-url";
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
    sumber: string[];
  }[];
}

export interface StockGudangInitial {
  rows: StockBranchRow[];
  total_rows: number;
  warehouses: WarehouseCol[];
  summary: StockBranchSummary | null;
  warehousesGagal: boolean;
  error: string | null;
}

const fmt = (n: number) => new Intl.NumberFormat("id-ID").format(n);
const tglJam = (iso: string | null) =>
  iso == null
    ? "belum pernah"
    : new Date(iso).toLocaleString("id-ID", {
        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
      });

type Filter = StockQuery["filter"];

// Halaman berdiri sendiri (route /stok-gudang, domain Purchasing). Mode server:
// page.tsx mengambil SATU halaman sesuai URL (filter, cari, urut, halaman);
// tombol filter di sini hanya mengubah URL.
export function StockGudangView({ initial, query }: { initial: StockGudangInitial; query: StockQuery }) {
  const router = useRouter();
  const { push } = useTableUrl(query.q);
  const filter = query.filter;
  const gantiFilter = (f: Filter) => push({ filter: f === "semua" ? null : f, page: null });

  if (initial.error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <EmptyState title="Gagal memuat stok per gudang" description="Data belum bisa dimuat. Muat ulang halaman; kalau tetap kosong, laporkan ke admin sistem." />
          <Button size="sm" variant="outline" className="mt-3" onClick={() => router.refresh()}>
            Coba lagi
          </Button>
        </CardContent>
      </Card>
    );
  }
  const branch = initial;
  const adaCari = !!query.q;

  return (
    <div className="space-y-4">
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
                Data terakhir masuk: <span className="font-medium">{tglJam(branch.summary.terakhir_update)}</span>
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
                  {/* Setelah puller F37 hidup, kartu-kartu ini bercampur: yang
                      dipetakan ke Accurate tersegarkan otomatis, lima cabang
                      yang di-skip masih CSV opname. Tanpa label, keduanya
                      tampil sama meyakinkan. */}
                  {w.sumber.length > 0 && (
                    <p className="text-muted-foreground mt-1 text-[11px]">
                      sumber: {w.sumber.includes("accurate") ? "Accurate" : w.sumber.join(", ")}
                      {w.sumber.length > 1 && ` (+${w.sumber.length - 1} lain)`}
                    </p>
                  )}
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

          {branch.total_rows === 0 && !adaCari ? (
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
                  ? "Data stok per gudang cabang belum diimpor. Hubungi admin sistem."
                  : "Coba filter lain."
              }
            />
          ) : (
            <>
              <StockBranchTable rows={branch.rows} warehouses={branch.warehouses} totalRows={branch.total_rows} query={query} />
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
    </div>
  );
}
