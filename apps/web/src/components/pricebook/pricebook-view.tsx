"use client";

import { useMemo, useState } from "react";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ExportButton } from "@/components/ui/export-button";
import { FilterCombo, FilterSelect, opsiDari } from "@/components/ui/filter-select";
import { Badge } from "@/components/ui/badge";

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
// Tab "Di Luar Keagenan" DILEPAS 1 Agt 2026 (keputusan user): menu ini
// difokuskan ke produk keagenan saja. Statistik cakupan Accurate-vs-keagenan
// masih hidup di menu Ringkasan Price Book, jadi tak ada angka yang hilang.
// Tab "Katalog" (snapshot mentah `product_pricelist` 071) DILEPAS 10 Agt 2026
// (keputusan user): sejak sumber harga pindah ke file Compilation FINAL, katalog
// dan harga terpublikasi berisi SKU yang sama — dua tab untuk satu daftar cuma
// bikin sales ragu mana yang sah dikutip. Yang sah = yang sudah dipublikasikan
// HoD Business, itulah yang tersisa di sini.
//
// Tabel 071 sendiri TIDAK dipensiunkan: dia tetap basis harga yang di-FK oleh
// `product_pricelist_setup` (073) dan sumber hitung menu Ringkasan Price Book.
// Yang hilang cuma mukanya.
export type PricebookTabKey = "harga";

// Muka AM: harga keagenan yang SUDAH dipublikasikan HoD Business dari Setup
// Harga. Bentuknya dibatasi di query API (/pricebook/published) — kolom hpp &
// margin tidak pernah di-SELECT, jadi tak ada jalan bocor ke browser.
export interface PublishedRow {
  rowNo: number;
  kode: string | null;
  productKode: string | null;
  lini: string;
  productLine: string | null;
  brand: string;
  nama: string;
  varian: string | null;
  kemasan: string | null;
  satuan: string | null;
  kategori: string | null;
  priceList: number;
  diskonMaks: number;
  hargaNett: number;
  nettPpn: number;
  publishedAt: string | null;
}
export interface HargaPanel { rows: PublishedRow[] }

export function PricebookView({
  harga,
}: {
  /** Harga keagenan terpublikasi. null/undefined = user tak berhak. */
  harga?: HargaPanel | null;
}) {
  if (!harga) {
    return (
      <EmptyState
        title="Harga belum tersedia"
        description="Kamu belum berizin melihat harga terpublikasi, atau apps/api tidak aktif."
      />
    );
  }
  return <HargaTab rows={harga.rows} />;
}

// ── Tab: Harga per Produk (bekas menu Pricelist, tabel 043) ────────────────

function HargaTab({ rows }: { rows: PublishedRow[] }) {
  const [lini, setLini] = useState("");
  const [productLine, setProductLine] = useState("");
  const [brand, setBrand] = useState("");
  const [kategori, setKategori] = useState("");

  // Opsi diambil dari data yang ADA di layar, bukan daftar tetap: kalau HoD
  // Business belum mem-publish satu lini/brand, filternya tidak perlu muncul.
  const opsiLini = useMemo(() => opsiDari(rows, (r) => r.lini), [rows]);
  // Opsi filter menyempit mengikuti pilihan di sebelah kirinya (lini → product
  // line → brand/kategori), jadi tidak ada pilihan yang pasti menghasilkan nol baris.
  const dalamLini = useMemo(
    () => rows.filter((r) => !lini || r.lini === lini),
    [rows, lini],
  );
  const opsiLine = useMemo(() => opsiDari(dalamLini, (r) => r.productLine), [dalamLini]);
  const dalamLine = useMemo(
    () => dalamLini.filter((r) => !productLine || (r.productLine ?? "") === productLine),
    [dalamLini, productLine],
  );
  const opsiBrand = useMemo(() => opsiDari(dalamLine, (r) => r.brand), [dalamLine]);
  const opsiKategori = useMemo(() => opsiDari(dalamLine, (r) => r.kategori), [dalamLine]);
  const tampil = useMemo(
    () => rows.filter((r) =>
      (!lini || r.lini === lini)
      && (!productLine || (r.productLine ?? "") === productLine)
      && (!brand || r.brand === brand)
      && (!kategori || (r.kategori ?? "") === kategori)),
    [rows, lini, productLine, brand, kategori],
  );
  const adaFilter = !!(lini || productLine || brand || kategori);
  const reset = () => { setLini(""); setProductLine(""); setBrand(""); setKategori(""); };

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Belum ada harga terpublikasi"
        description="HoD Business belum mempublikasikan harga keagenan dari menu Setup Harga. Halaman ini khusus harga yang sudah disetujui untuk dikutip ke faskes."
      />
    );
  }
  const kolom: DataColumn<PublishedRow>[] = [
    { id: "kode", header: "Kode", sortable: true,
      accessor: (r) => r.productKode ?? r.kode ?? "",
      cell: (r) => <span className="font-mono text-xs whitespace-nowrap">{r.productKode ?? r.kode ?? "—"}</span> },
    { id: "nama", header: "Nama Produk", sortable: true, accessor: (r) => r.nama,
      cell: (r) => (
        <div className="max-w-[24rem]">
          <span className="block truncate" title={r.nama}>{r.nama}</span>
          <span className="text-muted-foreground block truncate text-xs">
            {r.brand}{r.varian ? ` · ${r.varian}` : ""}{r.kemasan ? ` · ${r.kemasan}` : ""}
          </span>
        </div>
      ), className: "max-w-[24rem]" },
    { id: "lini", header: "Lini", sortable: true, accessor: (r) => r.lini,
      cell: (r) => (
        <div>
          <Badge variant="outline">{r.lini}</Badge>
          {r.productLine && (
            <span className="text-muted-foreground mt-0.5 block truncate text-xs" title={r.productLine}>
              {r.productLine}
            </span>
          )}
        </div>
      ) },
    { id: "pl", header: "Price List", align: "right", sortable: true, accessor: (r) => r.priceList,
      cell: (r) => <span className="whitespace-nowrap">{fmtRp(r.priceList)}</span> },
    { id: "diskon", header: "Diskon Maks", align: "right", sortable: true, accessor: (r) => r.diskonMaks,
      cell: (r) => <span className="whitespace-nowrap">{fmtPctDisc(r.diskonMaks)}</span> },
    { id: "nett", header: "Nett (lantai)", align: "right", sortable: true, accessor: (r) => r.hargaNett,
      cell: (r) => <span className="whitespace-nowrap">{fmtRp(r.hargaNett)}</span> },
    { id: "ppn", header: "Nett + PPN", align: "right", sortable: true, accessor: (r) => r.nettPpn,
      cell: (r) => <span className="font-medium whitespace-nowrap">{fmtRp(r.nettPpn)}</span> },
  ];
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <p className="rounded-md bg-sky-50 p-2 text-xs text-sky-900">
          <b>Nett (lantai)</b> adalah harga terendah yang boleh dikutip tanpa izin Direksi.
          PPN 11% dihitung dari Nett, bukan dari Price List.
        </p>
        <DataTable
          columns={kolom}
          data={tampil}
          getKey={(r) => String(r.rowNo)}
          searchPlaceholder="Cari nama / brand / kode…"
          pageSize={25}
          initialSort={{ id: "nama", dir: "asc" }}
          empty="Tidak ada harga yang cocok."
          toolbar={
            <div className="flex flex-wrap items-center gap-2">
              <FilterSelect label="Lini" value={lini} options={opsiLini}
                onChange={(v) => { setLini(v); setProductLine(""); setBrand(""); setKategori(""); }} />
              {/* Daftar panjang → dropdown ber-kotak-cari (57 product line, ±90 brand). */}
              <FilterCombo label="Product Line" value={productLine} options={opsiLine}
                onChange={(v) => { setProductLine(v); setBrand(""); setKategori(""); }} />
              <FilterCombo label="Brand" value={brand} onChange={setBrand} options={opsiBrand} />
              <FilterCombo label="Kategori" value={kategori} onChange={setKategori} options={opsiKategori} />
              {adaFilter && (
                <>
                  <span className="text-xs text-muted-foreground">
                    {fmtNum(tampil.length)} dari {fmtNum(rows.length)}
                  </span>
                  <button onClick={reset} className="rounded-md border px-2 py-1 text-xs hover:bg-muted">
                    Reset
                  </button>
                </>
              )}
              {/* Export mengikuti filter — kalau tidak, isi file beda dari yang dilihat. */}
              <ExportButton
              filename="harga-keagenan-terpublikasi"
              data={tampil}
              columns={[
                { header: "Kode", value: (r) => r.productKode ?? r.kode ?? "" },
                { header: "Lini", value: (r) => r.lini },
                { header: "Product Line", value: (r) => r.productLine ?? "" },
                { header: "Brand", value: (r) => r.brand },
                { header: "Nama", value: (r) => r.nama },
                { header: "Varian", value: (r) => r.varian ?? "" },
                { header: "Kemasan", value: (r) => r.kemasan ?? "" },
                { header: "Satuan", value: (r) => r.satuan ?? "" },
                { header: "Price List", value: (r) => r.priceList },
                { header: "Diskon Maks", value: (r) => r.diskonMaks },
                { header: "Nett", value: (r) => r.hargaNett },
                { header: "Nett + PPN", value: (r) => r.nettPpn },
              ]}
              />
            </div>
          }
        />
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
