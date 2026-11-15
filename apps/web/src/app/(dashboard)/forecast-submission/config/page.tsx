"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SkeletonTable } from "@/components/ui/loading";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PagedTable } from "@/components/ui/paged-table";
import { TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { WILAYAH_OPTIONS } from "@/lib/approval-routing";

interface BufferRow {
  itemId: number;
  itemName: string;
  warehouseKode: string;
  warehouseNama: string;
  bufferPersen: number | null;
  bufferQty: number | null;
  bufferPerkiraan: number | null;
  avg6Bulan: number;
  currentQty: number;
}
interface StockItem {
  item_id: string;
  no: string;
  name: string;
}
interface Warehouse {
  kode: string;
  nama: string;
}

export default function ForecastBufferConfigPage() {
  const [rows, setRows] = useState<BufferRow[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [results, setResults] = useState<StockItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedItem, setSelectedItem] = useState<StockItem | null>(null);
  const [selectedWh, setSelectedWh] = useState("");
  const [bufferPersen, setBufferPersen] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [rRes, wRes] = await Promise.all([
        fetch("/api/forecast/buffer-config", { cache: "no-store" }),
        fetch("/api/stock/warehouses?aktif=1", { cache: "no-store" }),
      ]);
      const rData = await rRes.json();
      const wData = await wRes.json();
      if (!rRes.ok) throw new Error(rData.error ?? "gagal memuat config");
      setRows(rData.rows ?? []);
      setWarehouses(wData.warehouses ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [rRes, wRes] = await Promise.all([
          fetch("/api/forecast/buffer-config", { cache: "no-store" }),
          fetch("/api/stock/warehouses?aktif=1", { cache: "no-store" }),
        ]);
        const rData = await rRes.json();
        const wData = await wRes.json();
        if (!active) return;
        if (!rRes.ok) throw new Error(rData.error ?? "gagal memuat config");
        setRows(rData.rows ?? []);
        setWarehouses(wData.warehouses ?? []);
      } catch (e) {
        if (active) setError(String(e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function searchItems() {
    setSearching(true);
    try {
      const res = await fetch(`/api/stock/branch?q=${encodeURIComponent(q)}&limit=15`, { cache: "no-store" });
      const data = await res.json();
      setResults((data.rows ?? []).map((r: { item_id: string; no: string; name: string }) => ({ item_id: r.item_id, no: r.no, name: r.name })));
    } finally {
      setSearching(false);
    }
  }

  // Tampilkan katalog langsung saat halaman dibuka — sebelumnya kosong sampai
  // pencet "Cari" dulu, padahal q="" sudah valid (API balas N item pertama).
  // Ditemukan user 2026-09-07 (pola sama F15).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- searchItems() men-setState saat fetch; disengaja.
    void searchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sekali saat mount saja
  }, []);

  async function save() {
    setSaveError(null);
    if (!selectedItem || !selectedWh || !bufferPersen) {
      setSaveError("pilih item, gudang, dan isi buffer (%) dulu");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/forecast/buffer-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          itemId: Number(selectedItem.item_id),
          warehouseKode: selectedWh,
          bufferPersen: Number(bufferPersen),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal simpan");
      setSelectedItem(null);
      setSelectedWh("");
      setBufferPersen("");
      setResults([]);
      setQ("");
      await load();
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Setup Buffer & Wilayah</h1>
        <p className="text-muted-foreground">
          F19 — safety stock per item per gudang dalam <b>persen dari rata-rata penjualan per bulan</b>. Stok minimum =
          persen × rata-rata penjualan pada rentang yang dipilih saat Generate (mis. 20% × 70/bln = 14). Item tanpa
          buffer tidak pernah kena alert (bukan error).
        </p>
        <p className="text-muted-foreground mt-1 text-xs italic">
          ⚠️ Sementara diisi manual — Accurate kemungkinan sudah punya data buffer ini secara native, tapi
          menariknya otomatis butuh ubah kode sinkronisasi Accurate (di luar kewenangan magang). Halaman ini
          pengganti sementara sampai itu tersedia.{" "}
          <Link href="/forecast-submission" className="text-primary underline">
            Kembali ke Forecast Submission
          </Link>
        </p>
      </div>

      <WilayahCabangCard />

      <CabangGudangCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tambah / Ubah Buffer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="cari nama/kode item…" />
            <Button type="button" onClick={() => void searchItems()} disabled={searching}>
              {searching ? "Mencari…" : "Cari"}
            </Button>
          </div>
          {results.length > 0 && (
            <div className="max-h-48 overflow-auto rounded-md border">
              {results.map((it) => (
                <button
                  key={it.item_id}
                  type="button"
                  onClick={() => {
                    setSelectedItem(it);
                    setResults([]);
                  }}
                  className="hover:bg-muted block w-full px-3 py-2 text-left text-sm"
                >
                  {it.name} <span className="text-muted-foreground text-xs">({it.no})</span>
                </button>
              ))}
            </div>
          )}
          {selectedItem && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="text-sm">
                Item: <span className="font-medium">{selectedItem.name}</span>
              </div>
              <div className="min-w-48">
                <Label className="mb-1 block text-xs">Gudang</Label>
                <Select value={selectedWh} onValueChange={(v) => setSelectedWh(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Pilih gudang" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses.map((w) => (
                      <SelectItem key={w.kode} value={w.kode}>
                        {w.nama}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-32">
                <Label className="mb-1 block text-xs">Buffer (%)</Label>
                <Input type="number" min={0} max={1000} step="any" placeholder="mis. 20" value={bufferPersen} onChange={(e) => setBufferPersen(e.target.value)} />
              </div>
              <Button onClick={() => void save()} disabled={saving}>
                {saving ? "Menyimpan…" : "Simpan"}
              </Button>
            </div>
          )}
          {saveError && <p className="text-destructive text-sm">{saveError}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Buffer Terkonfigurasi ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {error && <p className="text-destructive text-sm">{error}</p>}
          {loading ? (
            <SkeletonTable rows={5} cols={5} />
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">Belum ada buffer dikonfigurasi.</p>
          ) : (
            <PagedTable
              label="buffer"
              header={
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Gudang</TableHead>
                    <TableHead className="text-right">Buffer</TableHead>
                    <TableHead className="text-right">Rata²/bln gudang (6 bln)</TableHead>
                    <TableHead className="text-right">≈ Stok minimum</TableHead>
                    <TableHead className="text-right">Stok Saat Ini</TableHead>
                  </TableRow>
                </TableHeader>
              }
              rows={rows.map((r) => (
                <TableRow key={`${r.itemId}-${r.warehouseKode}`}>
                  <TableCell>{r.itemName}</TableCell>
                  <TableCell>{r.warehouseNama}</TableCell>
                  <TableCell className="text-right">
                    {r.bufferPersen != null ? `${r.bufferPersen.toLocaleString("id-ID")}%` : `${r.bufferQty ?? "–"} (angka lama)`}
                  </TableCell>
                  <TableCell className="text-right">{r.avg6Bulan.toLocaleString("id-ID")}</TableCell>
                  <TableCell className="text-right">{r.bufferPerkiraan == null ? "–" : r.bufferPerkiraan.toLocaleString("id-ID")}</TableCell>
                  <TableCell
                    className={`text-right ${r.bufferPerkiraan != null && r.bufferPerkiraan > 0 && r.currentQty <= r.bufferPerkiraan ? "text-destructive font-medium" : ""}`}
                  >
                    {r.currentQty}
                  </TableCell>
                </TableRow>
              ))}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface WilayahRow {
  kode: string;
  nama: string;
  wilayah: string | null;
}

// Wilayah approval per cabang (migrasi 317): dokumen forecast cabang diajukan
// ke HoD Sales wilayah ini di tahap 1 — dipetakan sekali di sini, bukan dipilih
// tiap kali mengajukan. Cabang tanpa wilayah: dokumennya tak bisa diajukan.
function WilayahCabangCard() {
  const [rows, setRows] = useState<WilayahRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/forecast/wilayah-cabang", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "gagal memuat wilayah cabang");
        if (active) setRows(data.rows ?? []);
      } catch (e) {
        if (active) setError(String(e instanceof Error ? e.message : e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function ubah(kode: string, wilayah: string) {
    setBusy(kode);
    setError(null);
    try {
      const res = await fetch("/api/forecast/wilayah-cabang", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kode, wilayah: wilayah || null }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal simpan");
      setRows((prev) => prev.map((r) => (r.kode === kode ? { ...r, wilayah: wilayah || null } : r)));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  }

  const belum = rows.filter((r) => !r.wilayah).length;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Wilayah Approval per Cabang</CardTitle>
        <p className="text-muted-foreground text-xs">
          Menentukan HoD Sales tahap 1 untuk dokumen forecast cabang itu.
          {belum > 0 && <span className="text-destructive"> {belum} cabang belum dipetakan — dokumennya belum bisa diajukan.</span>}
        </p>
      </CardHeader>
      <CardContent>
        {error && <p className="text-destructive mb-2 text-sm">{error}</p>}
        {loading ? (
          <SkeletonTable rows={4} cols={2} />
        ) : (
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((r) => (
              <div key={r.kode} className="flex items-center justify-between gap-3 text-sm">
                <span className={r.wilayah ? "" : "text-destructive"}>{r.nama}</span>
                <select
                  className="border-input bg-card h-8 w-32 rounded-lg border px-2 text-sm"
                  value={r.wilayah ?? ""}
                  disabled={busy === r.kode}
                  onChange={(e) => void ubah(r.kode, e.target.value)}
                >
                  <option value="">Belum diatur</option>
                  {WILAYAH_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label.split(" — ")[0]}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface CabangGudangRow {
  cabang: string;
  faktur: number;
  warehouseKode: string | null;
  sumber: "manual" | "otomatis" | null;
}

// Rata-rata penjualan per gudang memakai cabang AM pada tanggal faktur
// (migrasi 319). Nama cabang AM yang tak sama dengan gudang mana pun dipetakan
// di sini; yang tak dipetakan tidak dihitung ke gudang mana pun.
function CabangGudangCard() {
  const [rows, setRows] = useState<CabangGudangRow[]>([]);
  const [tanpa, setTanpa] = useState(0);
  const [gudang, setGudang] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [r, w] = await Promise.all([
          fetch("/api/forecast/cabang-gudang", { cache: "no-store" }),
          fetch("/api/forecast/wilayah-cabang", { cache: "no-store" }),
        ]);
        const data = await r.json();
        const wd = await w.json();
        if (!r.ok) throw new Error(data.error ?? "gagal memuat peta cabang");
        if (!active) return;
        setRows(data.rows ?? []);
        setTanpa(Number(data.persenTanpaGudang ?? 0));
        setGudang((wd.rows ?? []).map((x: { kode: string; nama: string }) => ({ kode: x.kode, nama: x.nama })));
      } catch (e) {
        if (active) setError(String(e instanceof Error ? e.message : e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [tick]);

  async function ubah(cabang: string, warehouseKode: string) {
    setBusy(cabang);
    setError(null);
    try {
      const res = await fetch("/api/forecast/cabang-gudang", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cabang, warehouseKode: warehouseKode || null }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal simpan");
      setTick((t) => t + 1);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  }

  const belum = rows.filter((r) => !r.warehouseKode).length;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cabang Penjualan → Gudang</CardTitle>
        <p className="text-muted-foreground text-xs">
          Rata-rata penjualan per gudang dihitung dari cabang AM pada tanggal faktur (faktur tanpa AM: area lokasi
          customer). Nama cabang yang sama dengan gudang terpetakan otomatis; sisanya pilih gudangnya di sini.
          {tanpa > 0 && (
            <span className="text-destructive"> {tanpa.toLocaleString("id-ID")}% qty penjualan 12 bulan terakhir belum terhitung ke gudang mana pun.</span>
          )}
          {belum > 0 && <span className="text-destructive"> {belum} cabang belum dipetakan.</span>}
        </p>
      </CardHeader>
      <CardContent>
        {error && <p className="text-destructive mb-2 text-sm">{error}</p>}
        {loading ? (
          <SkeletonTable rows={4} cols={3} />
        ) : (
          <PagedTable
            label="cabang"
            header={
              <TableHeader>
                <TableRow>
                  <TableHead>Cabang penjualan</TableHead>
                  <TableHead className="text-right">Baris faktur 12 bln</TableHead>
                  <TableHead className="w-56">Gudang</TableHead>
                </TableRow>
              </TableHeader>
            }
            rows={rows.map((r) => (
              <TableRow key={r.cabang}>
                <TableCell className={r.warehouseKode ? "" : "text-destructive"}>{r.cabang}</TableCell>
                <TableCell className="text-right">{r.faktur.toLocaleString("id-ID")}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <select
                      className="border-input bg-card h-8 w-40 rounded-lg border px-2 text-sm"
                      value={r.warehouseKode ?? ""}
                      disabled={busy === r.cabang}
                      onChange={(e) => void ubah(r.cabang, e.target.value)}
                    >
                      <option value="">Belum dipetakan</option>
                      {gudang.map((g) => (
                        <option key={g.kode} value={g.kode}>{g.nama}</option>
                      ))}
                    </select>
                    {r.sumber === "otomatis" && <span className="text-muted-foreground text-xs">otomatis</span>}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          />
        )}
      </CardContent>
    </Card>
  );
}
