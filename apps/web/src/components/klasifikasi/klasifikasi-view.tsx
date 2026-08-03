"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CircleAlert, Info, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ExportButton } from "@/components/ui/export-button";

// ── Tipe (cermin apps/api/src/repo/klasifikasi.ts) ─────────────────────────
export type Level = "kategori" | "line" | "class" | "sub_class";

export interface TaxonomyNode {
  level: Level; kategoriId: string; classId: string | null; id: string;
  nama: string; aktif: boolean; jumlahKode: number;
}
export interface ProductCode {
  kode: string; kategoriId: string; lineId: string; classId: string; subClassId: string;
  seq: number; kategoriNama: string; lineNama: string; classNama: string; subClassNama: string;
  nama: string; namaPrincipal: string | null; kemasan: string | null; satuan: string | null;
  brand: string | null; penyedia: string | null; kode2025: string | null;
  kodeLegacy: string | null; legacyBeda: boolean; sumber: string;
  accurateItemId: number | null; catatan: string | null;
}
export interface ReviewRow {
  id: number; sumber: string; sumberBaris: number | null; nama: string;
  brand: string | null; penyedia: string | null; kode2025: string | null;
  kodeLegacy: string | null; kategoriNama: string | null; lineNama: string | null;
  classNama: string | null; subClassNama: string | null; masalah: string; status: string;
}
export interface KlasifikasiSummary {
  taxonomy: { kategori: number; line: number; class: number; subClass: number };
  kode: number;
  kodePerKategori: { kategoriId: string; nama: string; jumlah: number }[];
  kodePerSumber: { sumber: string; jumlah: number }[];
  cocokAccurate: number; tanpaKode2025: number; legacyBeda: number; reviewTerbuka: number;
  prefixHampirPenuh: { prefix: string; terpakai: number }[];
}

const fmt = (n: number) => n.toLocaleString("id-ID");
const INPUT = "mt-0.5 w-full rounded-md border border-input bg-background px-2 py-1 text-sm";

const TABS = [
  { key: "ringkasan", label: "Ringkasan" },
  { key: "generator", label: "Terbitkan Kode" },
  { key: "kode", label: "Kode Produk" },
  { key: "master", label: "Master Klasifikasi" },
  { key: "review", label: "Perlu Keputusan" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/** Indeks hirarkis dari daftar node — dipakai semua dropdown supaya pilihan
 *  Class/Sub Class selalu tersaring oleh induknya. Justru inilah bedanya dengan
 *  spreadsheet: di sana VLOOKUP mencocokkan NAMA saja, jadi "Consumable" Non-IVD
 *  bisa mengambil id Consumable milik IVD. */
function useIndex(taxonomy: TaxonomyNode[]) {
  return useMemo(() => {
    const kategori = taxonomy.filter((n) => n.level === "kategori");
    const line = new Map<string, TaxonomyNode[]>();
    const klas = new Map<string, TaxonomyNode[]>();
    const sub = new Map<string, TaxonomyNode[]>();
    for (const n of taxonomy) {
      if (n.level === "line") {
        line.set(n.kategoriId, [...(line.get(n.kategoriId) ?? []), n]);
      } else if (n.level === "class") {
        klas.set(n.kategoriId, [...(klas.get(n.kategoriId) ?? []), n]);
      } else if (n.level === "sub_class") {
        const k = `${n.kategoriId}|${n.classId}`;
        sub.set(k, [...(sub.get(k) ?? []), n]);
      }
    }
    const byNama = (a: TaxonomyNode, b: TaxonomyNode) => a.nama.localeCompare(b.nama, "id");
    for (const m of [line, klas, sub]) for (const [k, v] of m) m.set(k, [...v].sort(byNama));
    return { kategori: [...kategori].sort((a, b) => a.id.localeCompare(b.id)), line, klas, sub };
  }, [taxonomy]);
}

export function KlasifikasiView({
  summary, taxonomy, codes, review, canEdit,
}: {
  summary: KlasifikasiSummary | null;
  taxonomy: TaxonomyNode[] | null;
  codes: ProductCode[] | null;
  review: ReviewRow[];
  canEdit: boolean;
}) {
  const [tab, setTab] = useState<TabKey>("ringkasan");

  if (!taxonomy || !codes || !summary) {
    return <EmptyState title="Data tidak tersedia" description="Pastikan apps/api jalan & DATABASE_URL aktif." />;
  }
  if (summary.taxonomy.kategori === 0) {
    return (
      <EmptyState
        title="Master klasifikasi belum diimpor"
        description="Tabel product_kategori/line/class/sub_class masih kosong. Jalankan scripts/db/import_product_classification.py --db-product <DB_Product.csv> --produk … --db <target> --apply."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 rounded-lg border p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              tab === t.key ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            {t.label}
            {t.key === "review" && review.length > 0 && (
              <span className="ml-1.5 rounded bg-amber-100 px-1.5 text-xs text-amber-800">
                {fmt(review.length)}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "ringkasan" && <RingkasanTab s={summary} />}
      {tab === "generator" && <GeneratorTab taxonomy={taxonomy} canEdit={canEdit} />}
      {tab === "kode" && <KodeTab codes={codes} />}
      {tab === "master" && <MasterTab taxonomy={taxonomy} canEdit={canEdit} />}
      {tab === "review" && <ReviewTab rows={review} canEdit={canEdit} />}
    </div>
  );
}

// ── Ringkasan ──────────────────────────────────────────────────────────────
function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function RingkasanTab({ s }: { s: KlasifikasiSummary }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Kode produk terbit" value={fmt(s.kode)} hint="unik, dijamin oleh kunci database" />
        <Kpi
          label="Master klasifikasi"
          value={`${s.taxonomy.kategori} / ${s.taxonomy.line} / ${s.taxonomy.class} / ${fmt(s.taxonomy.subClass)}`}
          hint="Kategori / Product Line / Class / Sub Class"
        />
        <Kpi label="Cocok item Accurate" value={fmt(s.cocokAccurate)} hint="dipasangkan lewat kode 2025" />
        <Kpi label="Perlu keputusan" value={fmt(s.reviewTerbuka)} hint="kombinasi belum terdaftar di master" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Kode per kategori</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {s.kodePerKategori.map((r) => (
              <div key={r.kategoriId} className="flex justify-between border-b py-1 last:border-0">
                <span><span className="font-mono text-xs text-muted-foreground">{r.kategoriId}</span> {r.nama}</span>
                <span className="font-medium">{fmt(r.jumlah)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Kode per sumber data</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {s.kodePerSumber.map((r) => (
              <div key={r.sumber} className="flex justify-between border-b py-1 last:border-0">
                <span>{r.sumber}</span>
                <span className="font-medium">{fmt(r.jumlah)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CircleAlert className="h-4 w-4 text-amber-600" /> Yang perlu diperhatikan
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <span className="font-medium">{fmt(s.legacyBeda)}</span> kode berbeda dari kode hasil
            generator spreadsheet. Penyebabnya tiga: resolusi hirarkis (spreadsheet mencocokkan
            nama saja, jadi nama Class/Sub Class yang kembar mengambil id kategori lain), sub class
            dipaksa 3 digit (sheet Kroscek memakai 2 digit sehingga id ≥ 100 kepotong), dan nomor
            urut global per prefix (counter per-sheet pernah menerbitkan kode kembar). Kode lama
            tetap tersimpan di kolom <span className="font-mono text-xs">kode legacy</span>.
          </p>
          <p>
            <span className="font-medium">{fmt(s.tanpaKode2025)}</span> produk belum punya kode
            Accurate berjalan (kode 2025), jadi belum bisa dipasangkan otomatis ke item Accurate.
            Pemasangan hanya lewat kode — pencocokan nama menghasilkan pasangan palsu karena nama
            produk tidak unik.
          </p>
          {s.prefixHampirPenuh.length > 0 && (
            <p className="flex items-start gap-2 text-amber-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Nomor urut hampir penuh (batas 9999) di: {s.prefixHampirPenuh.map((p) => `${p.prefix} (${p.terpakai})`).join(", ")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Terbitkan kode ─────────────────────────────────────────────────────────
interface NextKode {
  prefix: string; seq: number; kode: string; terpakai: number;
  kategoriNama: string; lineNama: string; classNama: string; subClassNama: string;
}

function GeneratorTab({ taxonomy, canEdit }: { taxonomy: TaxonomyNode[]; canEdit: boolean }) {
  const router = useRouter();
  const ix = useIndex(taxonomy);
  const [kategori, setKategori] = useState("");
  const [line, setLine] = useState("");
  const [klas, setKlas] = useState("");
  const [sub, setSub] = useState("");
  const [preview, setPreview] = useState<NextKode | null>(null);
  const [form, setForm] = useState({
    nama: "", namaPrincipal: "", kemasan: "", satuan: "", brand: "", penyedia: "",
    kode2025: "", catatan: "",
  });
  const [pesan, setPesan] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const lengkap = !!(kategori && line && klas && sub);

  const lihatKode = useCallback(async () => {
    if (!lengkap) return;
    setPesan(null);
    const qs = new URLSearchParams({ kategori, line, class: klas, sub_class: sub });
    const res = await fetch(`/api/klasifikasi/next-kode?${qs}`);
    const d = await res.json();
    if (res.ok) setPreview(d as NextKode);
    else { setPreview(null); setPesan({ ok: false, text: d?.error ?? "gagal mengambil kode" }); }
  }, [kategori, line, klas, sub, lengkap]);

  async function terbitkan() {
    if (!lengkap || !form.nama.trim()) return;
    setBusy(true); setPesan(null);
    try {
      const res = await fetch("/api/klasifikasi/codes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kategoriId: kategori, lineId: line, classId: klas, subClassId: sub,
          nama: form.nama.trim(),
          namaPrincipal: form.namaPrincipal.trim() || null,
          kemasan: form.kemasan.trim() || null,
          satuan: form.satuan.trim() || null,
          brand: form.brand.trim() || null,
          penyedia: form.penyedia.trim() || null,
          kode2025: form.kode2025.trim() || null,
          catatan: form.catatan.trim() || null,
        }),
      });
      const d = await res.json();
      if (res.ok) {
        setPesan({ ok: true, text: `Kode terbit: ${d.kode} — ${form.nama.trim()}` });
        setForm({ nama: "", namaPrincipal: "", kemasan: "", satuan: "", brand: "", penyedia: "", kode2025: "", catatan: "" });
        setPreview(null);
        router.refresh();
      } else {
        setPesan({ ok: false, text: d?.error ?? "gagal menerbitkan kode" });
      }
    } finally {
      setBusy(false);
    }
  }

  const lines = ix.line.get(kategori) ?? [];
  const classes = ix.klas.get(kategori) ?? [];
  const subs = ix.sub.get(`${kategori}|${klas}`) ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">1. Pilih klasifikasi</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <label className="block text-sm">Kategori
            <select
              className={INPUT}
              value={kategori}
              onChange={(e) => { setKategori(e.target.value); setLine(""); setKlas(""); setSub(""); setPreview(null); }}
            >
              <option value="">—</option>
              {ix.kategori.map((k) => <option key={k.id} value={k.id}>{k.id} · {k.nama}</option>)}
            </select>
          </label>
          <label className="block text-sm">Product Line
            <select className={INPUT} value={line} disabled={!kategori}
                    onChange={(e) => { setLine(e.target.value); setPreview(null); }}>
              <option value="">—</option>
              {lines.map((n) => <option key={n.id} value={n.id}>{n.id} · {n.nama}</option>)}
            </select>
          </label>
          <label className="block text-sm">Class
            <select className={INPUT} value={klas} disabled={!kategori}
                    onChange={(e) => { setKlas(e.target.value); setSub(""); setPreview(null); }}>
              <option value="">—</option>
              {classes.map((n) => <option key={n.id} value={n.id}>{n.id} · {n.nama}</option>)}
            </select>
          </label>
          <label className="block text-sm">Sub Class
            <select className={INPUT} value={sub} disabled={!klas}
                    onChange={(e) => { setSub(e.target.value); setPreview(null); }}>
              <option value="">—</option>
              {subs.map((n) => <option key={n.id} value={n.id}>{n.id} · {n.nama}</option>)}
            </select>
          </label>
          {klas && subs.length === 0 && (
            <p className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Class ini belum punya Sub Class. Tambahkan dulu di tab Master Klasifikasi — jangan
              pakai Sub Class dari Class lain, kodenya akan bertentangan dengan master.
            </p>
          )}
          <Button variant="outline" size="sm" onClick={lihatKode} disabled={!lengkap}>
            Lihat kode berikutnya
          </Button>
          {preview && (
            <div className="rounded-md border bg-background p-3">
              <div className="font-mono text-lg font-semibold">{preview.kode}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {preview.kategoriNama} › {preview.lineNama} › {preview.classNama} › {preview.subClassNama}
                {" · "}urut {preview.seq} dari {preview.terpakai} produk yang sudah ada di prefix ini
              </div>
              <div className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3 w-3 shrink-0" />
                Angka ini pratinjau, bukan reservasi — nomor final ditetapkan saat disimpan.
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">2. Data produk</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <label className="block text-sm">Nama Accurate 2026 <span className="text-red-600">*</span>
            <input className={INPUT} value={form.nama} onChange={(e) => set("nama", e.target.value)} />
          </label>
          <label className="block text-sm">Nama barang principal
            <input className={INPUT} value={form.namaPrincipal} onChange={(e) => set("namaPrincipal", e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">Kemasan
              <input className={INPUT} value={form.kemasan} onChange={(e) => set("kemasan", e.target.value)} />
            </label>
            <label className="block text-sm">Satuan
              <input className={INPUT} value={form.satuan} onChange={(e) => set("satuan", e.target.value)} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">Brand
              <input className={INPUT} value={form.brand} onChange={(e) => set("brand", e.target.value)} />
            </label>
            <label className="block text-sm">Kode 2025 (Accurate berjalan)
              <input className={INPUT} value={form.kode2025} onChange={(e) => set("kode2025", e.target.value)}
                     placeholder="mis. AKS.0828" />
            </label>
          </div>
          <label className="block text-sm">Penyedia
            <input className={INPUT} value={form.penyedia} onChange={(e) => set("penyedia", e.target.value)} />
          </label>
          <label className="block text-sm">Catatan
            <input className={INPUT} value={form.catatan} onChange={(e) => set("catatan", e.target.value)} />
          </label>

          {canEdit ? (
            <Button onClick={terbitkan} disabled={busy || !lengkap || !form.nama.trim()}>
              {busy ? "Menyimpan…" : "Terbitkan kode"}
            </Button>
          ) : (
            <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
              Hanya HoD Business / Purchasing / admin yang boleh menerbitkan kode.
            </p>
          )}
          {pesan && (
            <p className={`rounded-md p-2 text-sm ${pesan.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
              {pesan.text}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Daftar kode ────────────────────────────────────────────────────────────
function KodeTab({ codes }: { codes: ProductCode[] }) {
  const [hanyaBeda, setHanyaBeda] = useState(false);
  const rows = useMemo(
    () => (hanyaBeda ? codes.filter((c) => c.legacyBeda) : codes),
    [codes, hanyaBeda],
  );

  const cols: DataColumn<ProductCode>[] = [
    { id: "kode", header: "Kode", accessor: (r) => r.kode, sortable: true,
      cell: (r) => <span className="font-mono text-xs">{r.kode}</span> },
    { id: "nama", header: "Nama Accurate 2026", accessor: (r) => r.nama, sortable: true },
    { id: "klas", header: "Klasifikasi",
      accessor: (r) => `${r.kategoriNama} ${r.lineNama} ${r.classNama} ${r.subClassNama}`,
      cell: (r) => (
        <span className="text-xs text-muted-foreground">
          {r.kategoriNama} › {r.lineNama} › {r.classNama} › {r.subClassNama}
        </span>
      ) },
    { id: "brand", header: "Brand", accessor: (r) => r.brand ?? "" },
    { id: "kode2025", header: "Kode 2025", accessor: (r) => r.kode2025 ?? "",
      cell: (r) => r.kode2025
        ? <span className="font-mono text-xs">{r.kode2025}</span>
        : <span className="text-xs text-muted-foreground">—</span> },
    { id: "legacy", header: "Kode dari spreadsheet", accessor: (r) => r.kodeLegacy ?? "",
      cell: (r) => !r.kodeLegacy
        ? <span className="text-xs text-muted-foreground">—</span>
        : r.legacyBeda
          ? <Badge variant="outline" className="font-mono text-[11px] text-amber-700">{r.kodeLegacy}</Badge>
          : <span className="font-mono text-xs text-muted-foreground">{r.kodeLegacy}</span> },
    { id: "sumber", header: "Sumber", accessor: (r) => r.sumber,
      cell: (r) => <span className="text-xs text-muted-foreground">{r.sumber}</span> },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Kode produk · {fmt(rows.length)} baris
        </CardTitle>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={cols}
          data={rows}
          getKey={(r) => r.kode}
          pageSize={25}
          searchPlaceholder="Cari kode, nama, kode 2025, brand…"
          toolbar={
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" checked={hanyaBeda}
                       onChange={(e) => setHanyaBeda(e.target.checked)} />
                hanya yang beda dari spreadsheet
              </label>
              <ExportButton
                filename="kode-produk"
                data={rows}
                columns={[
                  { header: "Kode", value: (r: ProductCode) => r.kode },
                  { header: "Nama Accurate 2026", value: (r: ProductCode) => r.nama },
                  { header: "Nama Principal", value: (r: ProductCode) => r.namaPrincipal },
                  { header: "Kategori", value: (r: ProductCode) => `${r.kategoriId} ${r.kategoriNama}` },
                  { header: "Product Line", value: (r: ProductCode) => `${r.lineId} ${r.lineNama}` },
                  { header: "Class", value: (r: ProductCode) => `${r.classId} ${r.classNama}` },
                  { header: "Sub Class", value: (r: ProductCode) => `${r.subClassId} ${r.subClassNama}` },
                  { header: "Kemasan", value: (r: ProductCode) => r.kemasan },
                  { header: "Satuan", value: (r: ProductCode) => r.satuan },
                  { header: "Brand", value: (r: ProductCode) => r.brand },
                  { header: "Penyedia", value: (r: ProductCode) => r.penyedia },
                  { header: "Kode 2025", value: (r: ProductCode) => r.kode2025 },
                  { header: "Kode spreadsheet", value: (r: ProductCode) => r.kodeLegacy },
                  { header: "Beda dari spreadsheet", value: (r: ProductCode) => (r.legacyBeda ? "ya" : "") },
                  { header: "Sumber", value: (r: ProductCode) => r.sumber },
                ]}
              />
            </div>
          }
        />
      </CardContent>
    </Card>
  );
}

// ── Master klasifikasi ─────────────────────────────────────────────────────
function MasterTab({ taxonomy, canEdit }: { taxonomy: TaxonomyNode[]; canEdit: boolean }) {
  const router = useRouter();
  const ix = useIndex(taxonomy);
  const [kategori, setKategori] = useState(ix.kategori[0]?.id ?? "");
  const [klas, setKlas] = useState("");
  const [pesan, setPesan] = useState<{ ok: boolean; text: string } | null>(null);

  async function simpan(n: { level: Level; kategoriId: string; classId?: string; id: string; nama: string }) {
    setPesan(null);
    const res = await fetch("/api/klasifikasi/taxonomy", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(n),
    });
    const d = await res.json();
    setPesan(res.ok ? { ok: true, text: `${n.nama} disimpan (${n.id}).` }
                    : { ok: false, text: d?.error ?? "gagal menyimpan" });
    if (res.ok) router.refresh();
  }

  async function hapus(n: TaxonomyNode) {
    setPesan(null);
    const qs = new URLSearchParams({ level: n.level, kategori: n.kategoriId, id: n.id });
    if (n.classId) qs.set("class", n.classId);
    const res = await fetch(`/api/klasifikasi/taxonomy?${qs}`, { method: "DELETE" });
    const d = await res.json();
    setPesan(res.ok ? { ok: true, text: `${n.nama} dihapus.` }
                    : { ok: false, text: d?.error ?? "gagal menghapus" });
    if (res.ok) router.refresh();
  }

  const lines = ix.line.get(kategori) ?? [];
  const classes = ix.klas.get(kategori) ?? [];
  const subs = ix.sub.get(`${kategori}|${klas}`) ?? [];
  const classNama = classes.find((c) => c.id === klas)?.nama ?? "";

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-4">
          <label className="text-sm">Kategori
            <select className={INPUT} value={kategori}
                    onChange={(e) => { setKategori(e.target.value); setKlas(""); }}>
              {ix.kategori.map((k) => <option key={k.id} value={k.id}>{k.id} · {k.nama}</option>)}
            </select>
          </label>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Nomor Product Line & Class berulang di tiap kategori, dan nomor Sub Class berulang di
            tiap Class — jadi satu id hanya bermakna bersama induknya.
          </p>
        </CardContent>
      </Card>

      {pesan && (
        <p className={`rounded-md p-2 text-sm ${pesan.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
          {pesan.text}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <NodePanel
          title="Product Line" nodes={lines} canEdit={canEdit} lebarId={2}
          onSimpan={(id, nama) => simpan({ level: "line", kategoriId: kategori, id, nama })}
          onHapus={hapus}
        />
        <NodePanel
          title="Class" nodes={classes} canEdit={canEdit} lebarId={2}
          aktifId={klas} onPilih={(id) => setKlas(id === klas ? "" : id)}
          onSimpan={(id, nama) => simpan({ level: "class", kategoriId: kategori, id, nama })}
          onHapus={hapus}
        />
        <NodePanel
          title={klas ? `Sub Class · ${classNama}` : "Sub Class"}
          nodes={subs} canEdit={canEdit} lebarId={3}
          kosong={klas ? "Belum ada Sub Class di Class ini." : "Pilih Class dulu di kolom tengah."}
          onSimpan={klas ? (id, nama) => simpan({ level: "sub_class", kategoriId: kategori, classId: klas, id, nama }) : undefined}
          onHapus={hapus}
        />
      </div>
    </div>
  );
}

function NodePanel({
  title, nodes, canEdit, lebarId, aktifId, kosong, onPilih, onSimpan, onHapus,
}: {
  title: string;
  nodes: TaxonomyNode[];
  canEdit: boolean;
  lebarId: 2 | 3;
  aktifId?: string;
  kosong?: string;
  onPilih?: (id: string) => void;
  onSimpan?: (id: string, nama: string) => void;
  onHapus: (n: TaxonomyNode) => void;
}) {
  const [id, setId] = useState("");
  const [nama, setNama] = useState("");
  const idValid = new RegExp(`^\\d{${lebarId}}$`).test(id);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title} · {nodes.length}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="max-h-80 space-y-0.5 overflow-y-auto text-sm">
          {nodes.length === 0 && (
            <p className="py-2 text-xs text-muted-foreground">{kosong ?? "Belum ada data."}</p>
          )}
          {nodes.map((n) => (
            <div
              key={`${n.classId ?? ""}-${n.id}`}
              className={`flex items-center justify-between gap-2 rounded px-1.5 py-1 ${
                aktifId === n.id ? "bg-primary/10" : "hover:bg-muted"} ${onPilih ? "cursor-pointer" : ""}`}
              onClick={onPilih ? () => onPilih(n.id) : undefined}
            >
              <span className="truncate">
                <span className="font-mono text-xs text-muted-foreground">{n.id}</span> {n.nama}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <span className="text-xs text-muted-foreground">{fmt(n.jumlahKode)}</span>
                {canEdit && n.jumlahKode === 0 && (
                  <button
                    className="text-muted-foreground hover:text-red-600"
                    title="Hapus (hanya bisa kalau belum dipakai kode)"
                    onClick={(e) => { e.stopPropagation(); onHapus(n); }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>

        {canEdit && onSimpan && (
          <div className="flex items-end gap-2 border-t pt-2">
            <label className="w-20 text-xs">id
              <input className={INPUT} value={id} onChange={(e) => setId(e.target.value)}
                     placeholder={lebarId === 3 ? "031" : "09"} />
            </label>
            <label className="flex-1 text-xs">nama baru
              <input className={INPUT} value={nama} onChange={(e) => setNama(e.target.value)} />
            </label>
            <Button
              size="sm" variant="outline" disabled={!idValid || !nama.trim()}
              title={idValid ? "" : `id harus ${lebarId} digit angka`}
              onClick={() => { onSimpan(id, nama.trim()); setId(""); setNama(""); }}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Perlu keputusan ────────────────────────────────────────────────────────
function ReviewTab({ rows, canEdit }: { rows: ReviewRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [selesai, setSelesai] = useState<ReviewRow | null>(null);

  async function setStatus(id: number, status: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/klasifikasi/review/${id}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const cols: DataColumn<ReviewRow>[] = [
    { id: "nama", header: "Nama Accurate 2026", accessor: (r) => r.nama, sortable: true },
    { id: "klas", header: "Klasifikasi di sumber",
      accessor: (r) => `${r.kategoriNama} ${r.lineNama} ${r.classNama} ${r.subClassNama}`,
      cell: (r) => (
        <span className="text-xs text-muted-foreground">
          {r.kategoriNama} › {r.lineNama} › {r.classNama} › <span className="font-medium text-foreground">{r.subClassNama}</span>
        </span>
      ) },
    { id: "masalah", header: "Kenapa ditahan", accessor: (r) => r.masalah,
      cell: (r) => <span className="text-xs">{r.masalah}</span> },
    { id: "sumber", header: "Sumber", accessor: (r) => `${r.sumber} ${r.sumberBaris ?? ""}`,
      cell: (r) => <span className="text-xs text-muted-foreground">{r.sumber}{r.sumberBaris ? ` #${r.sumberBaris}` : ""}</span> },
    ...(canEdit ? [{
      id: "aksi", header: "", align: "right" as const,
      cell: (r: ReviewRow) => (
        <span className="flex justify-end gap-1">
          <Button size="sm" variant="outline" disabled={busy === r.id}
                  onClick={() => setSelesai(r)}>Selesaikan</Button>
          <Button size="sm" variant="ghost" disabled={busy === r.id}
                  onClick={() => setStatus(r.id, "diabaikan")}>Abaikan</Button>
        </span>
      ),
    }] : []),
  ];

  return (
    <Card>
      <SelesaikanDialog
        row={selesai}
        onOpenChange={(v) => !v && setSelesai(null)}
        onSelesai={() => { setSelesai(null); router.refresh(); }}
      />
      <CardHeader>
        <CardTitle className="text-base">Perlu keputusan HoD Business · {fmt(rows.length)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">
          Produk di bawah ini <span className="font-medium">tidak diberi kode</span>: nama Sub Class
          (atau Product Line / Class)-nya ada di master, tapi belum terdaftar di bawah induk yang
          dipakai barisnya. Kode produk menempel permanen di Accurate, jadi tidak ditebak. Cara
          menyelesaikan: daftarkan kombinasinya di tab Master Klasifikasi, lalu jalankan importer
          lagi — baris yang sudah bisa di-resolve otomatis hilang dari daftar ini. Tandai
          &ldquo;Beres&rdquo;/&ldquo;Abaikan&rdquo; hanya untuk baris yang memang tidak akan dikodekan.
        </p>
        <DataTable
          columns={cols}
          data={rows}
          getKey={(r) => String(r.id)}
          pageSize={25}
          searchPlaceholder="Cari nama, sub class, masalah…"
          empty="Tidak ada yang menunggu keputusan."
          toolbar={
            <ExportButton
              filename="klasifikasi-perlu-keputusan"
              data={rows}
              columns={[
                { header: "Sumber", value: (r: ReviewRow) => r.sumber },
                { header: "Baris", value: (r: ReviewRow) => r.sumberBaris },
                { header: "Nama Accurate 2026", value: (r: ReviewRow) => r.nama },
                { header: "Brand", value: (r: ReviewRow) => r.brand },
                { header: "Penyedia", value: (r: ReviewRow) => r.penyedia },
                { header: "Kode 2025", value: (r: ReviewRow) => r.kode2025 },
                { header: "Kode spreadsheet", value: (r: ReviewRow) => r.kodeLegacy },
                { header: "Kategori", value: (r: ReviewRow) => r.kategoriNama },
                { header: "Product Line", value: (r: ReviewRow) => r.lineNama },
                { header: "Class", value: (r: ReviewRow) => r.classNama },
                { header: "Sub Class", value: (r: ReviewRow) => r.subClassNama },
                { header: "Masalah", value: (r: ReviewRow) => r.masalah },
              ]}
            />
          }
        />
      </CardContent>
    </Card>
  );
}

// ── Dialog "Selesaikan" satu baris antrean ─────────────────────────────────
// Sebelum 1 Agt 2026 tombolnya cuma menandai status 'beres': baris hilang dari
// antrean padahal kode tak pernah terbit dan master tetap kurang. User benar
// waktu bilang "kagak tau larinya data bakal ke mana" — memang tak ke mana-mana.
//
// Sekarang satu aksi menyelesaikan betulan lewat POST
// /klasifikasi/review/:id/selesaikan (satu transaksi di server): daftarkan sub
// class baru di bawah induk baris itu ATAU pakai yang sudah ada → terbitkan kode
// → tandai beres → pautkan ke baris price book. Semua hasilnya dilaporkan di sini
// supaya jelas apa yang terjadi.
function SelesaikanDialog({
  row, onOpenChange, onSelesai,
}: {
  row: ReviewRow | null;
  onOpenChange: (v: boolean) => void;
  onSelesai: () => void;
}) {
  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {row ? <SelesaikanBody row={row} onSelesai={onSelesai} /> : null}
      </DialogContent>
    </Dialog>
  );
}

interface HasilSelesai {
  kode: string; subClassId: string; didaftarkan: boolean; sudahAda?: boolean;
  pricebookDipautkan: number;
}

function SelesaikanBody({ row, onSelesai }: { row: ReviewRow; onSelesai: () => void }) {
  const [mode, setMode] = useState<"baru" | "ada">("baru");
  const [nama, setNama] = useState(row.subClassNama ?? "");
  const [pilihan, setPilihan] = useState<{ id: string; nama: string }[]>([]);
  const [subId, setSubId] = useState("");
  const [induk, setInduk] = useState<{ kategoriId: string; classId: string } | null>(null);
  const [memuat, setMemuat] = useState(false);
  const [akui, setAkui] = useState(false);
  const [perluAkui, setPerluAkui] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hasil, setHasil] = useState<HasilSelesai | null>(null);

  // Pilihan sub class dimuat saat mode "pakai yang sudah ada" dipilih, bukan lewat
  // useEffect saat dialog dibuka: daftarnya cuma perlu di mode itu, dan memuat
  // dari event handler menghindari setState di dalam efek (cascading render).
  async function pilihMode(m: "baru" | "ada") {
    setMode(m);
    if (m !== "ada" || pilihan.length > 0 || memuat) return;
    setMemuat(true);
    try {
      const res = await fetch(`/api/klasifikasi/review/${row.id}/sub-class`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d.error ?? "gagal memuat pilihan sub class"); return; }
      setPilihan(d.rows ?? []);
      setInduk({ kategoriId: d.kategoriId, classId: d.classId });
    } catch {
      setErr("gagal memuat pilihan sub class");
    } finally {
      setMemuat(false);
    }
  }

  async function kirim() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/klasifikasi/review/${row.id}/selesaikan`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subClassId: mode === "ada" ? subId : null,
          subClassNama: mode === "baru" ? nama.trim() : null,
          akuiNamaSama: akui,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(d.error ?? "gagal menyelesaikan");
        if (String(d.error ?? "").includes("centang konfirmasi")) setPerluAkui(true);
        return;
      }
      setHasil(d as HasilSelesai);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  if (hasil) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Selesai</DialogTitle>
          <DialogDescription>{row.nama}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-2 text-sm">
          <p>
            Kode produk: <b className="font-mono">{hasil.kode}</b>
            {hasil.sudahAda ? " (sudah ada sebelumnya — baris antrean ditutup)" : " (baru diterbitkan)"}
          </p>
          {hasil.didaftarkan && (
            <p className="text-muted-foreground text-xs">
              Sub class <b>{nama.trim()}</b> didaftarkan ke master dengan id <b>{hasil.subClassId}</b>.
            </p>
          )}
          <p className="text-muted-foreground text-xs">
            {hasil.pricebookDipautkan > 0
              ? `${hasil.pricebookDipautkan} baris price book ikut dapat pautan kode ini (KPI "Dapat kode produk" di Setup Harga naik).`
              : "Tidak ada baris price book yang cocok untuk dipautkan (kode 5-bagian di sheet tidak ketemu)."}
          </p>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onSelesai}>Tutup</Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Selesaikan &amp; terbitkan kode</DialogTitle>
        <DialogDescription>
          {row.nama}
          {row.kode2025 ? ` · ${row.kode2025}` : " · tanpa kode 2025"}
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="space-y-4">
        <div className="bg-muted/40 rounded-md border p-2 text-xs">
          <div>
            Induk: <b>{row.kategoriNama}</b> › <b>{row.lineNama}</b> › <b>{row.classNama}</b>
            {induk ? ` (${induk.kategoriId}.${induk.classId})` : ""}
          </div>
          <div className="text-muted-foreground mt-1">{row.masalah}</div>
        </div>

        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" className="mt-1" checked={mode === "baru"} onChange={() => void pilihMode("baru")} />
            <span className="flex-1">
              <b>Daftarkan sub class baru</b> ke master
              <input className={INPUT} value={nama} onChange={(e) => setNama(e.target.value)}
                     placeholder="nama sub class" disabled={mode !== "baru"} />
              <span className="text-muted-foreground text-xs">
                Id 3 digit berikutnya di class ini dipakai otomatis.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" className="mt-1" checked={mode === "ada"} onChange={() => void pilihMode("ada")} />
            <span className="flex-1">
              <b>Pakai sub class yang sudah ada</b>{" "}
              {memuat ? "(memuat…)" : pilihan.length ? `(${pilihan.length} terdaftar)` : ""}
              <select className={INPUT} value={subId} onChange={(e) => setSubId(e.target.value)}
                      disabled={mode !== "ada"}>
                <option value="">— pilih —</option>
                {pilihan.map((o) => (
                  <option key={o.id} value={o.id}>{o.id} · {o.nama}</option>
                ))}
              </select>
            </span>
          </label>
        </div>

        {perluAkui && (
          <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            <input type="checkbox" className="mt-0.5" checked={akui} onChange={(e) => setAkui(e.target.checked)} />
            <span>
              Saya sudah memeriksa di tab Kode Produk: produk bernama sama itu memang produk yang
              sama dengan baris ini. (Baris ini tak punya kode 2025, jadi pencocokannya cuma lewat nama.)
            </span>
          </label>
        )}

        {err && <p className="text-sm text-red-600">{err}</p>}
        <p className="text-muted-foreground text-xs">
          Kode produk menempel permanen di Accurate — kalau induknya masih salah, batalkan dan
          betulkan dulu di tab Master Klasifikasi.
        </p>
      </DialogBody>

      <DialogFooter>
        <Button onClick={() => void kirim()}
                disabled={busy || (mode === "baru" ? !nama.trim() : !subId) || (perluAkui && !akui)}>
          Terbitkan kode
        </Button>
      </DialogFooter>
    </>
  );
}
