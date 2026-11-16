"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { FilterCombo, FilterSelect } from "@/components/ui/filter-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SkeletonCardGrid } from "@/components/ui/loading";
import { PagedTable } from "@/components/ui/paged-table";
import { TableHead, TableHeader, TableRow, TableCell } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useConfirm } from "@/components/ui/use-confirm";
import { usePrompt } from "@/components/ui/use-prompt";
import { KATEGORI_OPTIONS, labelReview, labelWilayah } from "@/lib/forecast-review";
import { edSudahLewat, tanggalLokalIso } from "@/lib/forecast-ed";

// F19 — usulan dikumpulkan per DOKUMEN cabang × kategori × bulan (migrasi 317,
// keputusan user 15 Nov 2026): satu dokumen = satu review HoD Sales wilayah
// gudang (migrasi 326, keputusan product owner 16 Nov 2026 — menggantikan
// approval F11). Purchasing melihat rekap semua cabang per barang di tab
// Rekap Purchasing.

interface Line {
  id: string;
  itemNo: string | null;
  itemName: string;
  kategori: string | null;
  reasons: string[];
  currentQty: number;
  bufferQty: number | null;
  nearestEdDate: string | null;
  avgMonthlyQty6m: number | null;
  avgDari: string | null;
  avgSampai: string | null;
  avgJenis: string | null;
  brand: string | null;
  bufferPersen: number | null;
  suggestedQty: number;
  finalQty: number | null;
  notes: string | null;
  status: string;
  purchaseOrderNumber: string | null;
  purchaseOrderMati?: boolean;
}

interface Dokumen {
  id: string;
  kode: string;
  warehouseNama: string;
  wilayah: string | null;
  kategori: string | null;
  periode: string;
  status: string;
  reviewStatus: string | null;
  reviewRegion: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  /** Pemakai ini boleh memutus review dokumen ini sekarang (dihitung API). */
  bolehReview: boolean;
  submittedBy: string | null;
  jumlahBarang: number;
  totalQty: number;
  lines: Line[];
  /** Baris disaring brand — aksi dokumen ditahan. */
  tersaring?: boolean;
}

interface RekapCabang {
  suggestionId: string;
  warehouseKode: string;
  warehouseNama: string;
  qty: number;
  status: string;
  poNumber: string | null;
  poMati: boolean;
}

interface RekapBarang {
  itemId: number;
  itemNo: string | null;
  itemName: string;
  kategori: string | null;
  totalQty: number;
  cabang: RekapCabang[];
  belumPo: number;
}

const REASON_LABEL: Record<string, string> = {
  near_buffer: "Di bawah buffer",
  near_ed: "Batch mendekati ED",
  ed_lewat: "Batch sudah lewat ED",
};
const DOK_STATUS = [
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Diajukan" },
  { value: "closed", label: "Ditutup" },
] as const;
const selectCls =
  "h-8 w-full rounded-lg border border-input bg-card px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const angka = (n: number) => n.toLocaleString("id-ID");
const bulanIni = () => tanggalLokalIso().slice(0, 7);
const namaBulan = (ym: string) =>
  new Date(`${ym}-01T00:00:00`).toLocaleDateString("id-ID", { month: "long", year: "numeric" });

interface Rentang {
  dari: string;
  sampai: string;
}

// N bulan kalender utuh sebelum bulan berjalan — sama dengan bawaan API.
function bulanTerakhir(n: number): Rentang {
  const t = new Date();
  return {
    dari: tanggalLokalIso(new Date(t.getFullYear(), t.getMonth() - n, 1)),
    sampai: tanggalLokalIso(new Date(t.getFullYear(), t.getMonth(), 0)),
  };
}
const tglPendek = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });

/** Rentang rata-rata baris dokumen: satu rentang, "beragam", atau baris lama (6 bulan terakhir). */
function labelRentang(lines: Line[]): string | null {
  const unik = [...new Set(lines.map((l) => (l.avgDari && l.avgSampai ? `${l.avgDari}|${l.avgSampai}` : "lama")))];
  if (unik.length === 0) return null;
  if (unik.length > 1) return "beragam per barang";
  if (unik[0] === "lama") return "6 bulan terakhir";
  const [a, b] = unik[0].split("|");
  return `${tglPendek(a)} – ${tglPendek(b)}`;
}

const PRESET = [3, 6, 12] as const;

// Jenis penjualan dasar rata-rata (migrasi 321): "" = KSO & Regular.
const JENIS_OPSI = [
  { value: "kso", label: "KSO" },
  { value: "regular", label: "Regular" },
];
const LABEL_JENIS: Record<string, string> = { semua: "KSO & Regular", kso: "KSO", regular: "Regular" };

function labelJenisBaris(lines: Line[]): string | null {
  const unik = [...new Set(lines.map((l) => l.avgJenis ?? "semua"))];
  if (unik.length === 0) return null;
  return unik.length > 1 ? "jenis beragam" : `penjualan ${LABEL_JENIS[unik[0]] ?? unik[0]}`;
}

function RentangPicker({ value, onChange }: { value: Rentang; onChange: (r: Rentang) => void }) {
  const hariIni = tanggalLokalIso();
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="grid gap-1">
        <Label className="text-xs">Rata-rata penjualan dari</Label>
        <Input type="date" className="bg-card h-8 w-auto" max={value.sampai || hariIni} value={value.dari}
          onChange={(e) => onChange({ ...value, dari: e.target.value })} />
      </div>
      <div className="grid gap-1">
        <Label className="text-xs">Sampai</Label>
        <Input type="date" className="bg-card h-8 w-auto" min={value.dari} max={hariIni} value={value.sampai}
          onChange={(e) => onChange({ ...value, sampai: e.target.value })} />
      </div>
      <div className="flex gap-1">
        {PRESET.map((n) => {
          const r = bulanTerakhir(n);
          const aktif = r.dari === value.dari && r.sampai === value.sampai;
          return (
            <Button key={n} size="sm" variant={aktif ? "default" : "soft"} onClick={() => onChange(r)}>
              {n} bln
            </Button>
          );
        })}
      </div>
    </div>
  );
}

async function kirim(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error ?? `gagal (${res.status})`);
  return data;
}

export default function ForecastSubmissionPage() {
  const [tab, setTab] = useState<"dokumen" | "rekap">("dokumen");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [rentang, setRentang] = useState<Rentang>(() => bulanTerakhir(6));
  const [jenis, setJenis] = useState("");
  const [brand, setBrand] = useState("");
  const [brandOpsi, setBrandOpsi] = useState<{ value: string; label: string }[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/forecast/brand", { cache: "no-store" });
        const data = await res.json();
        if (active && res.ok) setBrandOpsi((data.brand ?? []).map((b: string) => ({ value: b, label: b })));
      } catch {
        /* filter brand opsional — tanpa daftar, tetap jalan */
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  async function generate() {
    if (!rentang.dari || !rentang.sampai) {
      setError("isi rentang rata-rata penjualan (Dari & Sampai) dulu");
      return;
    }
    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const data = await kirim("/api/forecast/generate", "POST", { ...rentang, jenis: jenis || "semua", brand });
      setNotice(
        data.created > 0
          ? `${data.created} barang baru masuk ke ${data.dokumen} dokumen cabang` +
              (data.skippedExisting ? ` · ${data.skippedExisting} dilewati (masih berjalan)` : "")
          : `Tidak ada usulan baru${data.skippedExisting ? ` · ${data.skippedExisting} barang masih berjalan` : ""}`,
      );
      setTab("dokumen");
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Forecast Submission</h1>
          <p className="text-muted-foreground">
            F19 — usulan otomatis dari stok gudang (vs buffer & ED), dikumpulkan per dokumen cabang. Dokumen yang
            diajukan direview HoD Sales wilayahnya; Purchasing memakai rekap dokumen yang disetujui.
          </p>
        </div>
        <Button size="sm" variant="soft" render={<Link href="/forecast-submission/config" />} nativeButton={false}>
          Setup Buffer & Wilayah
        </Button>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end justify-between gap-3 pt-4">
          <div className="flex flex-wrap items-end gap-3">
            <RentangPicker value={rentang} onChange={setRentang} />
            <FilterSelect label="Jenis penjualan" value={jenis} onChange={setJenis} options={JENIS_OPSI} semua="KSO & Regular" />
            <FilterCombo label="Brand" value={brand} onChange={setBrand} options={brandOpsi} semua="Semua brand" />
          </div>
          <Button size="sm" onClick={() => void generate()} disabled={generating}>
            {generating ? "Men-generate…" : brand ? `Generate Usulan (${brand})` : "Generate Usulan"}
          </Button>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "dokumen" | "rekap")}>
        <TabsList>
          <TabsTrigger value="dokumen">Dokumen Cabang</TabsTrigger>
          <TabsTrigger value="rekap">Rekap Purchasing</TabsTrigger>
        </TabsList>
      </Tabs>

      {error && <p className="text-destructive text-sm">{error}</p>}
      {notice && <p className="text-sm text-amber-700 dark:text-amber-400">{notice}</p>}

      {tab === "dokumen" ? (
        <DokumenTab reloadKey={reloadKey} rentang={rentang} jenis={jenis || "semua"} brand={brand} onError={setError} onNotice={setNotice} />
      ) : (
        <RekapTab brand={brand} onError={setError} onNotice={setNotice} />
      )}
    </div>
  );
}

// ── Tab Dokumen Cabang ─────────────────────────────────────────────────────

function DokumenTab({
  reloadKey,
  rentang,
  jenis,
  brand,
  onError,
  onNotice,
}: {
  reloadKey: number;
  rentang: Rentang;
  jenis: string;
  brand: string;
  onError: (e: string | null) => void;
  onNotice: (n: string | null) => void;
}) {
  const [status, setStatus] = useState<string>("draft");
  const [bulan, setBulan] = useState<string>("");
  const [docs, setDocs] = useState<Dokumen[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({ status });
        if (bulan) qs.set("bulan", bulan);
        if (brand) qs.set("brand", brand);
        const res = await fetch(`/api/forecast/dokumen?${qs}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "gagal memuat dokumen");
        if (active) setDocs(data.dokumen ?? []);
      } catch (e) {
        if (active) onError(String(e instanceof Error ? e.message : e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [status, bulan, brand, tick, reloadKey, onError]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Tabs value={status} onValueChange={(v) => setStatus(String(v))}>
          <TabsList>
            {DOK_STATUS.map((s) => (
              <TabsTrigger key={s.value} value={s.value}>{s.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex items-end gap-2">
          <div className="grid gap-1">
            <Label className="text-xs">Bulan</Label>
            <Input type="month" className="bg-card w-40" value={bulan} onChange={(e) => setBulan(e.target.value)} />
          </div>
          {bulan && (
            <Button size="sm" variant="ghost" onClick={() => setBulan("")}>Semua bulan</Button>
          )}
        </div>
        <Button
          size="sm"
          variant="soft"
          className="ml-auto"
          disabled={docs.length === 0}
          render={<a href={`/api/forecast/dokumen/ekspor?${new URLSearchParams({ status, ...(bulan ? { bulan } : {}), ...(brand ? { brand } : {}) })}`} />}
          nativeButton={false}
        >
          Ekspor Excel
        </Button>
      </div>

      {loading ? (
        <SkeletonCardGrid count={2} />
      ) : docs.length === 0 ? (
        <p className="text-muted-foreground">
          Tidak ada dokumen {DOK_STATUS.find((s) => s.value === status)?.label.toLowerCase()}
          {bulan ? ` untuk ${namaBulan(bulan)}` : ""}.
          {status === "draft" ? " Klik Generate Usulan untuk memindai stok gudang." : ""}
        </p>
      ) : (
        <div className="space-y-4">
          {docs.map((d) => (
            <DokumenCard
              // Kunci ikut isi baris: data berubah (pindah kategori, simpan) → state edit dibangun ulang.
              key={`${d.id}:${d.lines.map((l) => `${l.id}${l.status}${l.finalQty ?? ""}${l.notes ?? ""}`).join("|")}`}
              dok={d}
              rentang={rentang}
              jenis={jenis} onChanged={reload} onError={onError} onNotice={onNotice} />
          ))}
        </div>
      )}
    </div>
  );
}

function DokumenCard({
  dok,
  rentang,
  jenis,
  onChanged,
  onError,
  onNotice,
}: {
  dok: Dokumen;
  rentang: Rentang;
  jenis: string;
  onChanged: () => void;
  onError: (e: string | null) => void;
  onNotice: (n: string | null) => void;
}) {
  const { confirm, dialog } = useConfirm();
  const { prompt, dialog: promptDialog } = usePrompt();
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<Record<string, { finalQty: string; notes: string }>>(() =>
    Object.fromEntries(dok.lines.map((l) => [l.id, { finalQty: String(l.finalQty ?? l.suggestedQty), notes: l.notes ?? "" }])),
  );
  const today = tanggalLokalIso();
  const draft = dok.status === "draft";
  const aktif = dok.lines.filter((l) => l.status !== "dismissed");
  const diabaikan = dok.lines.length - aktif.length;
  const review = labelReview(dok);
  // Dokumen lama (backfill approval F11 ditolak/dibatalkan) masih 'submitted' — hanya bisa ditutup.
  const ditolakLama = dok.status === "submitted" && dok.reviewStatus === "ditolak";
  const bisaPutus = dok.bolehReview && dok.status === "submitted" && dok.reviewStatus === "menunggu";
  const totalEdit = aktif.reduce((a, l) => a + (draft ? Number(edit[l.id]?.finalQty || 0) : (l.finalQty ?? l.suggestedQty)), 0);

  const berubah = (l: Line) => {
    const e = edit[l.id];
    if (!e) return false;
    return Number(e.finalQty) !== (l.finalQty ?? l.suggestedQty) || e.notes !== (l.notes ?? "");
  };

  // Simpan baris yang berubah; false = ada yang gagal (pesan sudah di-set).
  async function simpanSemua(): Promise<boolean> {
    for (const l of aktif.filter((x) => x.status === "draft" && berubah(x))) {
      const e = edit[l.id];
      const qty = e.finalQty.trim() === "" ? null : Number(e.finalQty);
      if (qty != null && !(qty >= 0)) {
        onError(`qty final ${l.itemName} tidak valid`);
        return false;
      }
      try {
        await kirim(`/api/forecast/suggestions/${l.id}`, "PATCH", { finalQty: qty, notes: e.notes || null });
      } catch (err) {
        onError(`${l.itemName}: ${err instanceof Error ? err.message : err}`);
        return false;
      }
    }
    return true;
  }

  async function jalankan(fn: () => Promise<void>) {
    setBusy(true);
    onError(null);
    onNotice(null);
    try {
      await fn();
    } catch (e) {
      onError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  const simpan = () => jalankan(async () => {
    if (await simpanSemua()) onChanged();
  });

  const ajukan = () =>
    confirm(
      {
        title: `Ajukan ${dok.kode}?`,
        description: `${aktif.length} barang · total qty ${angka(totalEdit)} — ${dok.warehouseNama}, ${dok.kategori}. Direview HoD Sales ${labelWilayah(dok.wilayah)} di dashboard (tanpa notifikasi WA).`,
        confirmLabel: "Ajukan",
      },
      () =>
        void jalankan(async () => {
          if (!(await simpanSemua())) return;
          const data = await kirim(`/api/forecast/dokumen/${dok.id}/submit`, "POST");
          onNotice(`${dok.kode} diajukan — menunggu review HoD Sales${data.reviewRegion ? ` ${data.reviewRegion}` : ""}.`);
          onChanged();
        }),
    );

  const setujui = () =>
    confirm(
      {
        title: `Setujui ${dok.kode}?`,
        description: `${aktif.length} barang · total qty ${angka(totalEdit)} — ${dok.warehouseNama}, ${dok.kategori}. Dokumen masuk Rekap Purchasing.`,
        confirmLabel: "Setujui",
      },
      () =>
        void jalankan(async () => {
          await kirim(`/api/forecast/dokumen/${dok.id}/review`, "POST", { keputusan: "disetujui" });
          onNotice(`${dok.kode} disetujui.`);
          onChanged();
        }),
    );

  const tolak = () =>
    prompt(
      {
        title: `Tolak ${dok.kode}?`,
        description: "Dokumen kembali ke draft agar diperbaiki lalu diajukan ulang. Catatan wajib diisi.",
        placeholder: "Alasan penolakan",
        confirmLabel: "Tolak",
        required: true,
        multiline: true,
        destructive: true,
        maxLength: 1000,
      },
      (catatan) =>
        void jalankan(async () => {
          await kirim(`/api/forecast/dokumen/${dok.id}/review`, "POST", { keputusan: "ditolak", catatan });
          onNotice(`${dok.kode} ditolak — dokumen kembali ke draft.`);
          onChanged();
        }),
    );

  const tutup = () =>
    confirm(
      {
        title: `Tutup ${dok.kode}?`,
        description: "Semua barang di dokumen ini diabaikan. Kekurangan stoknya akan muncul lagi saat Generate berikutnya.",
        confirmLabel: "Tutup dokumen",
        destructive: true,
      },
      () => void jalankan(async () => {
        await kirim(`/api/forecast/dokumen/${dok.id}/tutup`, "POST");
        onChanged();
      }),
    );

  const abaikan = (l: Line) =>
    confirm(
      { title: `Abaikan ${l.itemName}?`, description: "Barang ini dikeluarkan dari dokumen.", confirmLabel: "Abaikan", destructive: true },
      () => void jalankan(async () => {
        await kirim(`/api/forecast/suggestions/${l.id}/dismiss`, "POST", {});
        onChanged();
      }),
    );

  const pindahKategori = (l: Line, kategori: string) =>
    void jalankan(async () => {
      if (!(await simpanSemua())) return;
      await kirim(`/api/forecast/suggestions/${l.id}`, "PATCH", { kategori });
      onChanged();
    });

  const labelRata = [labelRentang(aktif), labelJenisBaris(aktif)].filter(Boolean).join(" · ");
  const rentangBaru = `${tglPendek(rentang.dari)} – ${tglPendek(rentang.sampai)}, ${LABEL_JENIS[jenis] ?? jenis}`;
  const tersaring = !!dok.tersaring;
  const hitungUlang = () =>
    confirm(
      {
        title: `Hitung ulang ${dok.kode}?`,
        description: `Rata-rata penjualan, stok minimum (buffer %), dan usulan sistem dihitung ulang dari ${rentangBaru}. Qty final yang sudah disimpan tidak berubah.`,
        confirmLabel: "Hitung ulang",
      },
      () => void jalankan(async () => {
        if (!(await simpanSemua())) return;
        await kirim(`/api/forecast/dokumen/${dok.id}/hitung-ulang`, "POST", { ...rentang, jenis });
        onNotice(`${dok.kode}: dihitung ulang dari ${rentangBaru}.`);
        onChanged();
      }),
    );

  const kolom = draft ? (dok.kategori ? 8 : 9) : 6;
  const header = (
    <TableHeader>
      <TableRow>
        <TableHead>Barang</TableHead>
        <TableHead className="text-right">Stok</TableHead>
        <TableHead className="text-right">Buffer</TableHead>
        {draft && <TableHead className="text-right">Rata²/bln</TableHead>}
        {draft && <TableHead className="text-right">Usulan</TableHead>}
        <TableHead className="w-28">{draft ? "Qty Final" : "Qty"}</TableHead>
        <TableHead>Catatan</TableHead>
        {draft && !dok.kategori && <TableHead className="w-36">Kategori</TableHead>}
        {draft ? <TableHead /> : <TableHead>PO</TableHead>}
      </TableRow>
    </TableHeader>
  );

  const rows = aktif.map((l) => {
    const lewat = edSudahLewat(l.nearestEdDate, today);
    return (
      <TableRow key={l.id}>
        <TableCell className="max-w-80">
          <div className="font-medium whitespace-normal">{l.itemName}</div>
          <div className="text-muted-foreground flex flex-wrap gap-x-2 text-xs">
            {l.itemNo && <span>{l.itemNo}</span>}
            {l.brand && <span>{l.brand}</span>}
            {l.reasons.map((r) => {
              const key = r === "near_ed" && lewat ? "ed_lewat" : r;
              return (
                <span key={r} className={key === "ed_lewat" ? "text-destructive" : undefined}>
                  {REASON_LABEL[key] ?? r}
                  {r === "near_ed" && l.nearestEdDate ? ` (${new Date(l.nearestEdDate).toLocaleDateString("id-ID")})` : ""}
                </span>
              );
            })}
          </div>
        </TableCell>
        <TableCell className="text-right tabular-nums">{angka(l.currentQty)}</TableCell>
        <TableCell className="text-right tabular-nums">
          {l.bufferQty == null ? "–" : angka(l.bufferQty)}
          {l.bufferPersen != null && <div className="text-muted-foreground text-xs">{angka(l.bufferPersen)}%</div>}
        </TableCell>
        {draft && <TableCell className="text-right tabular-nums">{l.avgMonthlyQty6m == null ? "–" : angka(l.avgMonthlyQty6m)}</TableCell>}
        {draft && <TableCell className="text-right tabular-nums">{angka(l.suggestedQty)}</TableCell>}
        <TableCell>
          {draft ? (
            <Input
              type="number"
              min={0}
              className="bg-card h-8 w-24"
              value={edit[l.id]?.finalQty ?? ""}
              onChange={(e) => setEdit((p) => ({ ...p, [l.id]: { ...p[l.id], finalQty: e.target.value } }))}
            />
          ) : (
            <span className="tabular-nums">{angka(l.finalQty ?? l.suggestedQty)}</span>
          )}
        </TableCell>
        <TableCell className="min-w-40">
          {draft ? (
            <Input
              className="bg-card h-8"
              placeholder="opsional"
              value={edit[l.id]?.notes ?? ""}
              onChange={(e) => setEdit((p) => ({ ...p, [l.id]: { ...p[l.id], notes: e.target.value } }))}
            />
          ) : (
            <span className="text-muted-foreground text-xs whitespace-normal">{l.notes ?? "–"}</span>
          )}
        </TableCell>
        {draft && !dok.kategori && (
          <TableCell>
            <select className={selectCls} value="" disabled={busy} onChange={(e) => e.target.value && pindahKategori(l, e.target.value)}>
              <option value="">Pilih…</option>
              {KATEGORI_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.value}</option>
              ))}
            </select>
          </TableCell>
        )}
        {draft ? (
          <TableCell className="text-right">
            <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => abaikan(l)}>
              Abaikan
            </Button>
          </TableCell>
        ) : (
          <TableCell className="text-xs">
            {l.purchaseOrderNumber ? (
              <Link href={`/purchase-orders?q=${encodeURIComponent(l.purchaseOrderNumber)}`} className="text-primary underline">
                {l.purchaseOrderMati ? "⚠️ " : ""}
                {l.purchaseOrderNumber}
              </Link>
            ) : (
              <span className="text-muted-foreground">–</span>
            )}
          </TableCell>
        )}
      </TableRow>
    );
  });

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base">
              {dok.warehouseNama} · {dok.kategori ?? "Belum ada kategori"} · {namaBulan(dok.periode)}
            </CardTitle>
            <div className="text-muted-foreground mt-1 flex flex-wrap gap-x-3 text-xs">
              <span>{dok.kode}</span>
              <span>{aktif.length} barang · total qty {angka(totalEdit)}</span>
              {diabaikan > 0 && <span>{diabaikan} diabaikan</span>}
              <span>
                Wilayah:{" "}
                {dok.wilayah ? (
                  labelWilayah(dok.wilayah)
                ) : (
                  <Link href="/forecast-submission/config" className="text-destructive underline">
                    belum dipetakan — atur di Setup
                  </Link>
                )}
              </span>
              {labelRata && <span>Rata-rata penjualan: {labelRata}</span>}
              {dok.submittedBy && <span>Diajukan oleh {dok.submittedBy}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="soft" render={<a href={`/api/forecast/dokumen/ekspor?id=${dok.id}`} />} nativeButton={false}>
              Excel
            </Button>
            {review && <Badge variant={review.variant}>{review.label}</Badge>}
          </div>
        </div>
        {review?.catatan && (
          <p className={`text-xs ${dok.reviewStatus === "ditolak" ? "text-destructive" : "text-muted-foreground"}`}>
            {dok.reviewStatus === "ditolak" ? "Catatan penolakan" : "Catatan review"}: {review.catatan}
          </p>
        )}
        {draft && !dok.kategori && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Barang di sini belum terklasifikasi IVD/Medical. Pilih kategori per barang — barangnya pindah ke dokumen
            {` ${dok.warehouseNama}`} kategori itu.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <PagedTable header={header} rows={rows} colSpan={kolom} empty="Tidak ada barang." label="barang" />
        {draft && tersaring && (
          <p className="text-muted-foreground border-t pt-3 text-right text-xs">
            Menampilkan sebagian barang (filter brand). Hapus filter brand untuk menyimpan, menghitung ulang, atau mengajukan dokumen ini.
          </p>
        )}
        {draft && !tersaring && (
          <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
            <Button size="sm" variant="ghost" disabled={busy} onClick={tutup}>
              Tutup dokumen
            </Button>
            <Button size="sm" variant="soft" disabled={busy || !rentang.dari || !rentang.sampai || aktif.length === 0} onClick={hitungUlang}>
              Hitung ulang ({rentangBaru})
            </Button>
            <Button size="sm" variant="soft" disabled={busy || !aktif.some(berubah)} onClick={() => void simpan()}>
              Simpan perubahan
            </Button>
            <Button size="sm" disabled={busy || !dok.kategori || !dok.wilayah || aktif.length === 0} onClick={ajukan}>
              {busy ? "Memproses…" : "Ajukan dokumen"}
            </Button>
          </div>
        )}
        {bisaPutus && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3 text-xs">
            <span className="text-muted-foreground">Anda dapat memutus review dokumen ini.</span>
            <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={tolak}>
              Tolak
            </Button>
            <Button size="sm" disabled={busy} onClick={setujui}>
              {busy ? "Memproses…" : "Setujui"}
            </Button>
          </div>
        )}
        {ditolakLama && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3 text-xs">
            <span className="text-muted-foreground">Dokumen lama ditolak — tidak bisa dilanjutkan.</span>
            <Button size="sm" variant="soft" disabled={busy} onClick={tutup}>
              Tutup dokumen
            </Button>
          </div>
        )}
      </CardContent>
      {dialog}
      {promptDialog}
    </Card>
  );
}

// ── Tab Rekap Purchasing ───────────────────────────────────────────────────

function RekapTab({
  brand,
  onError,
  onNotice,
}: {
  brand: string;
  onError: (e: string | null) => void;
  onNotice: (n: string | null) => void;
}) {
  const [bulan, setBulan] = useState(bulanIni);
  const [barang, setBarang] = useState<RekapBarang[]>([]);
  const [menunggu, setMenunggu] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [po, setPo] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/forecast/rekap?${new URLSearchParams({ bulan, ...(brand ? { brand } : {}) })}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "gagal memuat rekap");
        if (!active) return;
        setBarang(data.barang ?? []);
        setMenunggu(Number(data.menungguReview ?? 0));
      } catch (e) {
        if (active) onError(String(e instanceof Error ? e.message : e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [bulan, brand, tick, onError]);

  async function tautkan(b: RekapBarang) {
    const poNumber = (po[b.itemId] ?? "").trim();
    if (!poNumber) {
      onError("isi nomor PO Accurate dulu");
      return;
    }
    setBusy(b.itemId);
    onError(null);
    onNotice(null);
    try {
      const data = await kirim("/api/forecast/rekap/link-po", "POST", { bulan, itemId: b.itemId, poNumber });
      const catatan = [data.warning, ...(data.gagal ?? [])].filter(Boolean).join(" · ");
      onNotice(`${b.itemName}: ${data.linked} cabang tertaut ke ${data.poNumber}${catatan ? ` — ${catatan}` : ""}`);
      setPo((p) => ({ ...p, [b.itemId]: "" }));
      setTick((t) => t + 1);
    } catch (e) {
      onError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  }

  const totalQty = barang.reduce((a, b) => a + b.totalQty, 0);
  const header = (
    <TableHeader>
      <TableRow>
        <TableHead>Barang</TableHead>
        <TableHead>Kategori</TableHead>
        <TableHead>Rincian cabang</TableHead>
        <TableHead className="text-right">Total</TableHead>
        <TableHead className="w-72">PO Accurate</TableHead>
      </TableRow>
    </TableHeader>
  );
  const rows = barang.map((b) => {
    const poAda = [...new Set(b.cabang.map((c) => c.poNumber).filter((x): x is string => !!x))];
    return (
      <TableRow key={b.itemId}>
        <TableCell className="max-w-80">
          <div className="font-medium whitespace-normal">{b.itemName}</div>
          {b.itemNo && <div className="text-muted-foreground text-xs">{b.itemNo}</div>}
        </TableCell>
        <TableCell>{b.kategori ?? "–"}</TableCell>
        <TableCell>
          <div className="flex max-w-96 flex-wrap gap-1">
            {b.cabang.map((c) => (
              <Badge key={c.suggestionId} variant={c.poNumber && !c.poMati ? "default" : "outline"}>
                {c.warehouseNama.replace(/^Gudang /, "")} {angka(c.qty)}
              </Badge>
            ))}
          </div>
        </TableCell>
        <TableCell className="text-right font-semibold tabular-nums">{angka(b.totalQty)}</TableCell>
        <TableCell>
          {poAda.length > 0 && (
            <div className="mb-1 flex flex-wrap gap-x-2 text-xs">
              {poAda.map((n) => (
                <Link key={n} href={`/purchase-orders?q=${encodeURIComponent(n)}`} className="text-primary underline">
                  {n}
                </Link>
              ))}
            </div>
          )}
          {b.belumPo > 0 ? (
            <div className="flex gap-2">
              <Input
                className="bg-card h-8"
                placeholder="No. PO, mis. 1098/WRG/1126"
                value={po[b.itemId] ?? ""}
                onChange={(e) => setPo((p) => ({ ...p, [b.itemId]: e.target.value }))}
              />
              <Button size="sm" disabled={busy === b.itemId} onClick={() => void tautkan(b)}>
                {busy === b.itemId ? "…" : "Tautkan"}
              </Button>
            </div>
          ) : (
            <span className="text-muted-foreground text-xs">Semua cabang sudah tertaut</span>
          )}
        </TableCell>
      </TableRow>
    );
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <Label className="text-xs">Bulan</Label>
          <Input type="month" className="bg-card w-40" value={bulan} onChange={(e) => e.target.value && setBulan(e.target.value)} />
        </div>
        {menunggu > 0 && (
          <p className="text-muted-foreground text-sm">
            {menunggu} dokumen bulan ini masih menunggu review HoD Sales — belum masuk rekap.
          </p>
        )}
      </div>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="text-base">
              Rekap Purchasing — {namaBulan(bulan)}
              {brand ? ` · ${brand}` : ""}
            </CardTitle>
            <p className="text-muted-foreground mt-1 text-xs">
              Gabungan dokumen semua cabang yang sudah disetujui HoD Sales · {barang.length} barang · total qty {angka(totalQty)}.
              Buat PO di Accurate, lalu tautkan nomornya per barang (berlaku untuk semua cabang barang itu).
            </p>
          </div>
          <Button
            size="sm"
            variant="soft"
            disabled={barang.length === 0}
            render={<a href={`/api/forecast/rekap/ekspor?${new URLSearchParams({ bulan, ...(brand ? { brand } : {}) })}`} />}
            nativeButton={false}
          >
            Ekspor Excel
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <SkeletonCardGrid count={1} />
          ) : (
            <PagedTable
              header={header}
              rows={rows}
              colSpan={5}
              empty={`Belum ada dokumen yang disetujui untuk ${namaBulan(bulan)}.`}
              label="barang"
              resetKey={bulan}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
