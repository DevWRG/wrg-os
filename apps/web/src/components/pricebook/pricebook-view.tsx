"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, CircleAlert, Info } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ExportButton } from "@/components/ui/export-button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { AmPricelistTable } from "@/components/pricelist/am-pricelist-table";
import type { AmPricelistRow } from "@/lib/pricelist";

// ── Tipe (cermin apps/api/src/repo/pricebook.ts) ───────────────────────────
export interface PricebookItem {
  id: number; kode: string | null; lini: string; brand: string; nama: string;
  varian: string | null; kemasan: string | null; kategori: string | null;
  kategoriVerified: boolean; priceList: number; diskonMaks: number;
  hargaNett: number; nettPpn: number; rentangHarga: string | null;
  catatan: string | null; jumlahHarga: number;
}
export interface NamaValue { nama: string; sku: number; nilai: number; pct: number }
export interface PricebookSummary {
  periode: string;
  kosong: boolean;
  kpi: {
    sku: number; skuPerLini: { lini: string; sku: number }[];
    nilaiKatalog: number; nilaiPriceList: number; brand: number;
    brandPerLini: { lini: string; brand: number }[];
    konsentrasiTop: { lini: string; brand: string; pct: number } | null;
  };
  lini: { lini: string; sku: number; skuPct: number; nilai: number; nilaiPct: number }[];
  kategoriPerLini: { lini: string; rows: NamaValue[] }[];
  brandPerLini: { lini: string; rows: NamaValue[]; top10Pct: number }[];
  diskon: { tier: number; sku: number }[];
  rentang: { band: string; sku: number }[];
  risiko: {
    namaDuplikat: { kelompok: number; baris: number; contoh: { brand: string; nama: string; baris: number }[] };
    tanpaKode: number; kategoriBelumVerified: number; kategoriLainLain: number;
    konsentrasi: { lini: string; brand: string; pct: number; nilai: number }[];
  };
  cakupan: { accurateTotal: number; cocok: number; diLuarKeagenan: number; tanpaKode: number } | null;
}
interface OutsideItem {
  id: number; no: string | null; name: string | null; category: string | null;
  unit: string | null; unitPrice: number | null; quantity: number | null; available: number | null;
}

// ── Format ─────────────────────────────────────────────────────────────────
const rp = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const fmtRp = (n: number | null) => (n == null ? "—" : rp.format(n));
const fmtRpShort = (n: number) => {
  const v = n || 0;
  if (Math.abs(v) >= 1e12) return `Rp ${(v / 1e12).toFixed(2)} T`;
  if (Math.abs(v) >= 1e9) return `Rp ${(v / 1e9).toFixed(2)} M`;
  if (Math.abs(v) >= 1e6) return `Rp ${(v / 1e6).toFixed(1)} jt`;
  return fmtRp(v);
};
const fmtNum = (n: number) => n.toLocaleString("id-ID");
const fmtPctDisc = (d: number) => `${Math.round(d * 100)}%`;

const C = { ivd: "#0ca6bd", medical: "#10b981", warn: "#f59e0b", danger: "#ef4444", muted: "#94a3b8" };
const liniColor = (l: string) => (l === "IVD" ? C.ivd : C.medical);

// Menu harga untuk SALES: katalog keagenan + harga produk Accurate terpublikasi +
// item di luar keagenan. Satu pintu untuk apa yang boleh dikutip ke faskes.
//
// Dua muka lain sengaja BUKAN tab di sini, karena pembacanya beda:
//   /pricebook/ringkasan  bacaan portofolio — Direktur + HoD
//   /pricebook/setup      HPP & margin — HoD Business / Purchasing
// Menu terpisah juga bikin izinnya punya baris sendiri di matriks Akses Grup;
// sebuah tab tidak bisa dicentang sendiri.
const TABS = [
  { key: "katalog", label: "Katalog" },
  { key: "harga", label: "Harga per Produk" },
  { key: "luar", label: "Di Luar Keagenan" },
] as const;
export type PricebookTabKey = (typeof TABS)[number]["key"];

// Muka AM: baris SUDAH dibersihkan di server (tanpa hpp/margin) — lihat toAmRow().
export interface HargaPanel { rows: AmPricelistRow[] }

export function PricebookView({
  items, summary, harga, initialTab,
}: {
  items: PricebookItem[] | null;
  /** Dipakai hanya untuk statistik cakupan di tab Di Luar Keagenan; null = tak berhak. */
  summary: PricebookSummary | null;
  /** Baris pricelist terpublikasi (043). null/undefined = user tak berhak. */
  harga?: HargaPanel | null;
  initialTab?: PricebookTabKey;
}) {
  const tabs = useMemo(
    () => TABS.filter((t) => (t.key === "harga" ? !!harga : items !== null)),
    [harga, items],
  );
  const [tab, setTab] = useState<PricebookTabKey>(
    initialTab && tabs.some((t) => t.key === initialTab) ? initialTab : (tabs[0]?.key ?? "katalog"),
  );
  const aktif = tabs.some((t) => t.key === tab) ? tab : (tabs[0]?.key ?? "katalog");

  if (tabs.length === 0) {
    return <EmptyState title="Data tidak tersedia" description="Pastikan apps/api jalan & DATABASE_URL aktif." />;
  }
  // Price book kosong TAPI tab harga ada → jangan blokir seluruh halaman.
  if (items !== null && items.length === 0 && !harga) {
    return (
      <EmptyState
        title="Price book belum diimpor"
        description="Tabel product_pricelist masih kosong. Jalankan scripts/db/import_pricebook.py --file <CSV dari folder Drive 16-Sales-PriceList-H2-2026> --apply."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 rounded-lg border p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${aktif === t.key ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {aktif === "katalog" && <KatalogTab items={items ?? []} />}
      {aktif === "harga" && harga && <HargaTab rows={harga.rows} />}
      {aktif === "luar" && <LuarKeagenanTab cakupan={summary?.cakupan ?? null} />}
    </div>
  );
}

// ── Tab: Harga per Produk (bekas menu Pricelist, tabel 043) ────────────────

function HargaTab({ rows }: { rows: AmPricelistRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Belum ada harga terpublikasi"
        description="HoD Business belum mempublikasikan harga produk Accurate dari tab Setup Harga."
      />
    );
  }
  return (
    <Card>
      <CardContent className="pt-6">
        <AmPricelistTable rows={rows} />
      </CardContent>
    </Card>
  );
}

// ── Tab 1: Ringkasan ───────────────────────────────────────────────────────

export function RingkasanTab({ s }: { s: PricebookSummary | null }) {
  if (!s || s.kosong) {
    return <EmptyState title="Ringkasan belum bisa dihitung" description="Price book periode ini belum berisi data." />;
  }
  const skuLabel = s.kpi.skuPerLini.map((l) => `${l.lini} ${fmtNum(l.sku)}`).join(" · ");
  const brandLabel = s.kpi.brandPerLini.map((l) => `${l.lini} ${l.brand}`).join(" · ");
  const top = s.kpi.konsentrasiTop;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Total SKU" value={fmtNum(s.kpi.sku)} sub={skuLabel} />
        <Kpi label="Nilai katalog (nett)" value={fmtRpShort(s.kpi.nilaiKatalog)} sub={`price list ${fmtRpShort(s.kpi.nilaiPriceList)}`} />
        <Kpi label="Brand & principal" value={fmtNum(s.kpi.brand)} sub={brandLabel} />
        <Kpi label="SKU tanpa kode Accurate" value={fmtNum(s.risiko.tanpaKode)} sub="tak punya identitas unik utk quote" tone={s.risiko.tanpaKode > 0 ? "warn" : undefined} />
        <Kpi
          label={top ? `Konsentrasi ${top.lini}` : "Konsentrasi"}
          value={top ? `${top.pct}%` : "—"}
          sub={top ? `nilai ${top.lini} ada di ${top.brand}` : undefined}
          tone={top && top.pct >= 50 ? "danger" : undefined}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dua mesin — jumlah SKU vs nilai katalog terbalik</CardTitle>
          <p className="text-muted-foreground text-xs">
            Pangsa SKU dan pangsa nilai tiap lini bergerak berlawanan. Konsekuensinya kedua lini tidak bisa dikelola
            dengan cara yang sama.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <SplitBar title="Pangsa jumlah SKU" rows={s.lini.map((l) => ({ lini: l.lini, pct: l.skuPct, label: `${l.lini} ${l.skuPct}% (${fmtNum(l.sku)})` }))} />
          <SplitBar title="Pangsa nilai katalog" rows={s.lini.map((l) => ({ lini: l.lini, pct: l.nilaiPct, label: `${l.lini} ${l.nilaiPct}% (${fmtRpShort(l.nilai)})` }))} />
          <p className="text-muted-foreground text-xs">
            &ldquo;Nilai katalog&rdquo; = jumlah harga nett satu unit per SKU. Ini mengukur besar price book-nya, bukan
            omzet — tidak ada data volume di sumber.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {s.kategoriPerLini.map((k) => (
          <Card key={k.lini}>
            <CardHeader>
              <CardTitle className="text-base">Nilai per kategori — {k.lini}</CardTitle>
              <p className="text-muted-foreground text-xs">{k.rows.length} kategori · nilai nett, 1 unit per SKU.</p>
            </CardHeader>
            <CardContent><HBar rows={k.rows.slice(0, 10)} color={liniColor(k.lini)} /></CardContent>
          </Card>
        ))}
        {s.brandPerLini.map((b) => (
          <Card key={b.lini}>
            <CardHeader>
              <CardTitle className="text-base">Brand teratas — {b.lini}</CardTitle>
              <p className="text-muted-foreground text-xs">
                {b.rows[0] ? `${b.rows[0].nama} = ${b.rows[0].pct}% nilai ${b.lini}` : "—"} · top-10 = {b.top10Pct}%.
              </p>
            </CardHeader>
            <CardContent><HBar rows={b.rows.slice(0, 8)} color={liniColor(b.lini)} highlightFirst /></CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sebaran plafon diskon</CardTitle>
            <p className="text-muted-foreground text-xs">
              Diskon Maks = plafon yang boleh diberikan sales tanpa naik ke atasan.
            </p>
          </CardHeader>
          <CardContent><VBar rows={s.diskon.map((d) => ({ label: fmtPctDisc(d.tier), value: d.sku }))} color={C.ivd} /></CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sebaran rentang harga</CardTitle>
            <p className="text-muted-foreground text-xs">Jumlah SKU per band harga.</p>
          </CardHeader>
          <CardContent>
            <VBar rows={s.rentang.map((r) => ({ label: r.band.replace(/^[A-E]\.\s*/, ""), value: r.sku }))} color={C.medical} />
          </CardContent>
        </Card>
      </div>

      <RisikoCard s={s} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Margin & harga sub-dealer — belum tersedia</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            Infografis Direktur memuat margin kotor per principal dan band diskon Sub-Dealer. Keduanya belum bisa
            ditampilkan di sini karena HPP dan harga sub-dealer memang tidak ikut di file handover — bukan disembunyikan,
            tapi tidak pernah masuk ke output (HANDOVER §1).
          </p>
          <p className="text-muted-foreground">
            Begitu file HPP + price list sub-dealer masuk, dua kartu itu diisi dari data — bukan angka tempel, supaya ikut
            berubah saat price book di-impor ulang.
          </p>
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">
        Periode {s.periode}. Semua angka dihitung langsung dari isi price book yang diimpor. Masa berlaku Jul–Des 2026
        masih asumsi dari penamaan file sumber, belum ada dokumen kebijakan (HANDOVER §8 poin 7).
      </p>
    </div>
  );
}

function RisikoCard({ s }: { s: PricebookSummary }) {
  const d = s.risiko.namaDuplikat;
  return (
    <Card className="border-amber-300/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="size-4 text-amber-600" /> Yang perlu dijaga
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        <RisikoItem
          judul={`${d.kelompok} nama produk dipakai berulang = ${d.baris} baris`}
          isi={
            d.contoh.length
              ? `Nama persis sama, harga beda; pembedanya cuma varian. Terbanyak: ${d.contoh
                  .slice(0, 3)
                  .map((c) => `${c.nama} (${c.baris} harga)`)
                  .join(" · ")}. Di tab Katalog, SKU seperti ini diberi tanda "N harga" — sales wajib konfirmasi varian ke admin sebelum keluarkan penawaran.`
              : "Tidak ada nama produk yang dipakai berulang."
          }
          tone={d.kelompok > 0 ? "danger" : "ok"}
        />
        <RisikoItem
          judul={`${fmtNum(s.risiko.tanpaKode)} SKU tanpa kode Accurate`}
          isi="Tidak punya identitas unik untuk di-quote. Bertumpuk dengan masalah nama duplikat — kombinasi paling rawan salah quote."
          tone={s.risiko.tanpaKode > 0 ? "warn" : "ok"}
        />
        <RisikoItem
          judul={`${fmtNum(s.risiko.kategoriBelumVerified)} SKU kategorinya belum terverifikasi`}
          isi='Kategori hasil pemetaan kata kunci, tidak ada di master taxonomy WRG. Harga tetap valid — labelnya yang belum pasti. Label "sesuai master" pun bukan berarti sudah diperiksa manusia.'
          tone={s.risiko.kategoriBelumVerified > 0 ? "warn" : "ok"}
        />
        <RisikoItem
          judul={
            s.risiko.konsentrasi.length
              ? s.risiko.konsentrasi.map((k) => `${k.brand} ${k.pct}% dari ${k.lini}`).join(" · ")
              : "Konsentrasi principal"
          }
          isi="Ketergantungan satu principal: pergerakan pasokan atau harga di sana menggerakkan seluruh buku. Ini risiko terbesar di portofolio."
          tone={s.risiko.konsentrasi.some((k) => k.pct >= 50) ? "danger" : "warn"}
        />
      </CardContent>
    </Card>
  );
}

function RisikoItem({ judul, isi, tone }: { judul: string; isi: string; tone: "ok" | "warn" | "danger" }) {
  const cls =
    tone === "danger" ? "border-red-300/70 bg-red-50/60 dark:bg-red-950/20"
      : tone === "warn" ? "border-amber-300/70 bg-amber-50/60 dark:bg-amber-950/20"
      : "border-border";
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <div className="text-sm font-semibold">{judul}</div>
      <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{isi}</p>
    </div>
  );
}

// ── Tab 2: Katalog ─────────────────────────────────────────────────────────

function KatalogTab({ items }: { items: PricebookItem[] }) {
  const [lini, setLini] = useState<string>("");
  const [brand, setBrand] = useState<string>("");
  const [hanyaRisiko, setHanyaRisiko] = useState(false);

  const liniOpts = useMemo(() => [...new Set(items.map((i) => i.lini))].sort(), [items]);
  const brandOpts = useMemo(() => [...new Set(items.map((i) => i.brand))].sort(), [items]);

  const rows = useMemo(
    () => items.filter((i) =>
      (!lini || i.lini === lini) && (!brand || i.brand === brand) && (!hanyaRisiko || i.jumlahHarga > 1)),
    [items, lini, brand, hanyaRisiko],
  );

  const columns: DataColumn<PricebookItem>[] = [
    {
      id: "nama", header: "Produk", sortable: true,
      accessor: (r) => `${r.nama} ${r.varian ?? ""} ${r.kode ?? ""}`,
      cell: (r) => (
        <div className="min-w-[220px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{r.nama}</span>
            {r.varian && <Badge variant="secondary" className="text-[10px]">{r.varian}</Badge>}
            {r.jumlahHarga > 1 && (
              <span
                title="Nama produk ini dipakai beberapa SKU dengan harga berbeda — konfirmasi varian ke admin sebelum keluarkan penawaran."
                className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
              >
                <CircleAlert className="size-3" /> {r.jumlahHarga} harga
              </span>
            )}
          </div>
          <div className="text-muted-foreground mt-0.5 text-xs">
            {r.brand} · {r.kode ?? <span className="text-amber-600">tanpa kode Accurate</span>}
            {r.kemasan ? ` · ${r.kemasan}` : ""}
          </div>
        </div>
      ),
    },
    {
      id: "kategori", header: "Kategori", sortable: true, accessor: (r) => r.kategori ?? "",
      cell: (r) => (
        <span className="inline-flex items-center gap-1 text-sm">
          {r.kategori ?? "—"}
          {!r.kategoriVerified && (
            <span title="Kategori hasil pemetaan kata kunci, belum cocok master WRG. Harga tetap valid." className="size-1.5 rounded-full bg-amber-500" />
          )}
        </span>
      ),
    },
    { id: "lini", header: "Lini", sortable: true, accessor: (r) => r.lini },
    { id: "priceList", header: "Price List", align: "right", sortable: true, accessor: (r) => r.priceList, cell: (r) => fmtRp(r.priceList) },
    { id: "diskon", header: "Diskon Maks", align: "right", sortable: true, accessor: (r) => r.diskonMaks, cell: (r) => fmtPctDisc(r.diskonMaks) },
    {
      id: "nett", header: "Nett Terendah", align: "right", sortable: true, accessor: (r) => r.hargaNett,
      cell: (r) => <span className="font-semibold">{fmtRp(r.hargaNett)}</span>,
    },
    { id: "ppn", header: "Nett + PPN 11%", align: "right", sortable: true, accessor: (r) => r.nettPpn, cell: (r) => fmtRp(r.nettPpn) },
  ];

  return (
    <div className="space-y-4">
      <Card className="border-sky-300/60">
        <CardContent className="flex gap-2 py-3 text-xs">
          <Info className="mt-0.5 size-4 shrink-0 text-sky-600" />
          <div className="space-y-1">
            <p>
              <b>Cara pakai.</b> <b>Price List</b> adalah angka pembuka yang ditawarkan ke faskes. <b>Nett Terendah</b>{" "}
              adalah <b>lantai</b>, bukan target — menutup di bawah angka itu butuh izin Direksi.
            </p>
            <p className="text-muted-foreground">
              PPN 11% dihitung dari harga nett, bukan dari price list. Syaratnya: diskon <b>wajib dicantumkan di faktur
              pajak</b> — kalau hanya kesepakatan lisan atau cuma muncul di invoice komersial, DPP tidak berkurang secara
              sah dan WRG menanggung selisihnya.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1">
              <Label className="text-xs">Lini</Label>
              <select value={lini} onChange={(e) => setLini(e.target.value)} className="border-input bg-background h-9 rounded-md border px-2 text-sm">
                <option value="">Semua</option>
                {liniOpts.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Brand</Label>
              <select value={brand} onChange={(e) => setBrand(e.target.value)} className="border-input bg-background h-9 rounded-md border px-2 text-sm">
                <option value="">Semua ({brandOpts.length})</option>
                {brandOpts.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <label className="flex h-9 items-center gap-2 text-sm">
              <input type="checkbox" checked={hanyaRisiko} onChange={(e) => setHanyaRisiko(e.target.checked)} className="size-4" />
              Hanya SKU bernama ganda
            </label>
            <span className="text-muted-foreground pb-2 text-xs">{fmtNum(rows.length)} dari {fmtNum(items.length)} SKU</span>
          </div>
          <ExportButton
            filename="price-book-keagenan"
            data={rows}
            columns={[
              { header: "Kode", value: (r: PricebookItem) => r.kode },
              { header: "Lini", value: (r: PricebookItem) => r.lini },
              { header: "Brand", value: (r: PricebookItem) => r.brand },
              { header: "Nama", value: (r: PricebookItem) => r.nama },
              { header: "Varian", value: (r: PricebookItem) => r.varian },
              { header: "Kemasan", value: (r: PricebookItem) => r.kemasan },
              { header: "Kategori", value: (r: PricebookItem) => r.kategori },
              { header: "Kategori terverifikasi", value: (r: PricebookItem) => (r.kategoriVerified ? "YA" : "BELUM") },
              { header: "Price List", value: (r: PricebookItem) => r.priceList },
              { header: "Diskon Maks", value: (r: PricebookItem) => r.diskonMaks },
              { header: "Harga Nett Terendah", value: (r: PricebookItem) => r.hargaNett },
              { header: "Nett + PPN 11%", value: (r: PricebookItem) => r.nettPpn },
              { header: "Jumlah harga utk nama ini", value: (r: PricebookItem) => r.jumlahHarga },
              { header: "Catatan", value: (r: PricebookItem) => r.catatan },
            ]}
          />
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={rows}
            getKey={(r) => String(r.id)}
            pageSize={25}
            searchPlaceholder="Cari produk, brand, atau kode…"
            empty="Tidak ada SKU yang cocok."
          />
        </CardContent>
      </Card>
    </div>
  );
}

// ── Tab 3: Di luar keagenan ────────────────────────────────────────────────

function LuarKeagenanTab({ cakupan }: { cakupan: PricebookSummary["cakupan"] }) {
  const [rows, setRows] = useState<OutsideItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/pricebook/outside?limit=20000");
      if (!res.ok) throw new Error(String(res.status));
      setRows(((await res.json()).rows ?? []) as OutsideItem[]);
    } catch {
      setErr("Gagal memuat daftar item di luar keagenan.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() men-setState saat fetch selesai; disengaja.
    void load();
  }, [load]);

  const columns: DataColumn<OutsideItem>[] = [
    { id: "no", header: "Kode", sortable: true, accessor: (r) => r.no ?? "" },
    { id: "name", header: "Nama item", sortable: true, accessor: (r) => r.name ?? "" },
    { id: "category", header: "Kategori Accurate", sortable: true, accessor: (r) => r.category ?? "" },
    { id: "unit", header: "Satuan", accessor: (r) => r.unit ?? "" },
    {
      id: "unitPrice", header: "Harga rata-rata", align: "right", sortable: true,
      accessor: (r) => r.unitPrice ?? 0, cell: (r) => fmtRp(r.unitPrice),
    },
    { id: "quantity", header: "Stok", align: "right", sortable: true, accessor: (r) => r.quantity ?? 0, cell: (r) => (r.quantity == null ? "—" : fmtNum(r.quantity)) },
  ];

  return (
    <div className="space-y-4">
      <Card className="border-amber-300/60">
        <CardContent className="flex gap-2 py-3 text-xs">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <div className="space-y-1">
            <p>
              Item di bawah ada di Accurate tapi <b>tidak ada di price book keagenan</b> periode ini. Pencocokan lewat
              kode item (satu-satunya identitas yang dijamin sama antara dua sumber).
            </p>
            <p className="text-muted-foreground">
              Perlu diingat: {cakupan ? fmtNum(cakupan.tanpaKode) : "sebagian"} SKU keagenan sendiri belum punya kode
              Accurate, jadi sebagian isi daftar ini bisa jadi sebenarnya produk keagenan yang kodenya belum terisi.
              Itu pekerjaan pembersihan master, sengaja tidak ditebak-tebak lewat kecocokan nama.
            </p>
          </div>
        </CardContent>
      </Card>

      {cakupan && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Kpi label="Item Accurate" value={fmtNum(cakupan.accurateTotal)} sub="seluruh mirror katalog" />
          <Kpi label="Cocok keagenan" value={fmtNum(cakupan.cocok)} sub="punya pasangan di price book" />
          <Kpi label="Di luar keagenan" value={fmtNum(cakupan.diLuarKeagenan)} sub="tanpa pasangan" tone="warn" />
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Item Accurate di luar keagenan</CardTitle>
          {rows && rows.length > 0 && (
            <ExportButton
              filename="accurate-di-luar-keagenan"
              data={rows}
              columns={[
                { header: "Kode", value: (r: OutsideItem) => r.no },
                { header: "Nama", value: (r: OutsideItem) => r.name },
                { header: "Kategori", value: (r: OutsideItem) => r.category },
                { header: "Satuan", value: (r: OutsideItem) => r.unit },
                { header: "Harga rata-rata", value: (r: OutsideItem) => r.unitPrice },
                { header: "Stok", value: (r: OutsideItem) => r.quantity },
              ]}
            />
          )}
        </CardHeader>
        <CardContent>
          {err ? (
            <EmptyState title="Gagal memuat" description={err} />
          ) : rows === null ? (
            <div className="text-muted-foreground text-sm">Memuat…</div>
          ) : (
            <DataTable
              columns={columns}
              data={rows}
              getKey={(r) => String(r.id)}
              pageSize={25}
              searchPlaceholder="Cari item Accurate…"
              empty="Semua item Accurate ada di price book keagenan."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Bagian tampilan kecil ──────────────────────────────────────────────────

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "warn" | "danger" }) {
  const color = tone === "danger" ? "text-red-600" : tone === "warn" ? "text-amber-600" : "";
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{label}</div>
        <div className={`mt-1 text-2xl font-bold ${color}`}>{value}</div>
        {sub && <div className="text-muted-foreground mt-1 text-xs">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function SplitBar({ title, rows }: { title: string; rows: { lini: string; pct: number; label: string }[] }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold">{title}</div>
      <div className="flex h-8 overflow-hidden rounded-md">
        {rows.map((r) => (
          <div
            key={r.lini}
            style={{ width: `${Math.max(r.pct, 0)}%`, background: liniColor(r.lini) }}
            className="flex items-center justify-center overflow-hidden px-1 text-xs font-semibold whitespace-nowrap text-white"
            title={r.label}
          >
            {r.pct >= 12 ? r.label : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

// Bar horizontal: kategori/brand vs nilai. Batang pertama disorot saat
// highlightFirst — di lini yang terkonsentrasi, itu memang inti bacaannya.
function HBar({ rows, color, highlightFirst }: { rows: NamaValue[]; color: string; highlightFirst?: boolean }) {
  if (rows.length === 0) return <div className="text-muted-foreground text-sm">Tidak ada data.</div>;
  return (
    <ResponsiveContainer width="100%" height={Math.max(rows.length * 34, 120)}>
      <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 56, top: 4, bottom: 4 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="nama" width={130} tick={{ fontSize: 11 }} interval={0} />
        <Tooltip
          formatter={(v, _n, item) => {
            const p = (item as { payload?: NamaValue })?.payload;
            return [`${fmtRpShort(Number(v))}${p ? ` · ${p.sku} SKU · ${p.pct}%` : ""}`, "Nilai"];
          }}
          contentStyle={{ fontSize: 12 }}
        />
        <Bar dataKey="nilai" radius={[0, 4, 4, 0]} label={{ position: "right", fontSize: 11, formatter: (v) => fmtRpShort(Number(v)) }}>
          {rows.map((r, i) => (
            <Cell key={r.nama} fill={highlightFirst && i === 0 ? C.warn : color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function VBar({ rows, color }: { rows: { label: string; value: number }[]; color: string }) {
  if (rows.length === 0) return <div className="text-muted-foreground text-sm">Tidak ada data.</div>;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={rows} margin={{ left: 0, right: 8, top: 16, bottom: 4 }}>
        <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} />
        <YAxis hide />
        <Tooltip formatter={(v) => [`${fmtNum(Number(v))} SKU`, "Jumlah"]} contentStyle={{ fontSize: 12 }} />
        <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} label={{ position: "top", fontSize: 11 }} />
      </BarChart>
    </ResponsiveContainer>
  );
}
