"use client";

// Tab "Price Book" di menu Pricelist Setup — 1.031 SKU keagenan hasil kroscek
// Sheet2 (migrasi 073, importer scripts/db/import_kroscek_pricelist.py).
//
// Bedanya dengan tab "Produk Accurate": di sana harga DIHITUNG dari HPP + margin
// yang diinput manual per item Accurate. Di sini HARGA-nya yang final (dari
// handover Direktur) dan margin cuma turunan (1 - HPP/Price List) — jadi tidak
// ada tombol edit harga: angka harga milik price book, diubah lewat import ulang.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RotateCcw, Send } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ExportButton } from "@/components/ui/export-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Cermin apps/api/src/repo/pricebook.ts → PricebookSetupRow / PricebookSetupSummary.
export interface PricebookSetupRow {
  rowNo: number;
  kode: string | null;
  lini: string;
  brand: string;
  nama: string;
  namaFinal: string | null;
  varian: string | null;
  kemasan: string | null;
  satuan: string | null;
  priceList: number;
  diskonMaks: number;
  hargaNett: number;
  nettPpn: number;
  priceListAsli: number;
  diskonMaksAsli: number;
  adaOverride: boolean;
  hpp: number | null;
  marginPct: number | null;
  status: string;
  publishedAt: string | null;
  kategori: string | null;
  productLine: string | null;
  klas: string | null;
  subClass: string | null;
  productKode: string | null;
  klasifikasiLengkap: boolean;
}

export interface PricebookSetupSummary {
  periode: string;
  total: number;
  adaHpp: number;
  tanpaHpp: number;
  klasifikasiLengkap: number;
  kepasangKode: number;
  draft: number;
  published: number;
  adaOverride: number;
  reviewTerbuka: number;
  totalHpp: number;
  totalPriceList: number;
  marginAgregat: number | null;
}

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
const fmtPct = (f: number | null) =>
  f == null ? "—" : `${(f * 100).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;
const namaOf = (r: PricebookSetupRow) => r.namaFinal ?? r.nama;
const klasOf = (r: PricebookSetupRow) =>
  [r.productLine, r.klas, r.subClass].filter(Boolean).join(" › ");

type Filter = "semua" | "tanpa-hpp" | "klas-belum" | "tanpa-kode" | "draft" | "published" | "disetel";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "semua", label: "Semua" },
  { key: "draft", label: "Draft" },
  { key: "published", label: "Published" },
  { key: "disetel", label: "Harga disetel manual" },
  { key: "tanpa-hpp", label: "Belum ada HPP" },
  { key: "klas-belum", label: "Klasifikasi belum lengkap" },
  { key: "tanpa-kode", label: "Belum dapat kode produk" },
];

export function PricebookSetupTable({
  rows,
  ringkas,
  canPublish,
}: {
  rows: PricebookSetupRow[] | null;
  ringkas: PricebookSetupSummary | null;
  canPublish: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("semua");
  const [edit, setEdit] = useState<PricebookSetupRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [konfirmPublishAll, setKonfirmPublishAll] = useState(false);

  async function publishSemua() {
    setBusy(true);
    try {
      const res = await fetch("/api/pricebook/setup/publish", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
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

  const data = useMemo(() => {
    if (!rows) return [];
    switch (filter) {
      case "tanpa-hpp":
        return rows.filter((r) => r.hpp == null);
      case "klas-belum":
        return rows.filter((r) => !r.klasifikasiLengkap);
      case "tanpa-kode":
        return rows.filter((r) => !r.productKode);
      case "draft":
        return rows.filter((r) => r.status !== "published");
      case "published":
        return rows.filter((r) => r.status === "published");
      case "disetel":
        return rows.filter((r) => r.adaOverride);
      default:
        return rows;
    }
  }, [rows, filter]);

  if (rows === null) {
    return <EmptyState title="Data tidak tersedia" description="Pastikan apps/api jalan & DATABASE_URL aktif." />;
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Lapisan kroscek belum diimpor"
        description="Tabel product_pricelist_setup masih kosong. Jalankan scripts/db/import_kroscek_pricelist.py --file <CSV export Sheet2 Master Kroscek> --db <nama db> --apply (price book-nya harus sudah ada lewat import_pricebook.py)."
      />
    );
  }

  const columns: DataColumn<PricebookSetupRow>[] = [
    {
      id: "kode",
      header: "Kode Produk",
      sortable: true,
      accessor: (r) => r.productKode ?? r.kode ?? "",
      cell: (r) => (
        <span className="font-mono text-xs whitespace-nowrap">
          {r.productKode ?? <span className="text-muted-foreground">{r.kode ?? "—"}</span>}
        </span>
      ),
    },
    {
      id: "nama",
      header: "Nama Produk",
      sortable: true,
      accessor: (r) => namaOf(r),
      cell: (r) => (
        <div className="max-w-[24rem]">
          <span className="block truncate" title={namaOf(r)}>
            {namaOf(r)}
          </span>
          <span className="text-muted-foreground block truncate text-xs" title={`${r.brand}${r.varian ? ` · ${r.varian}` : ""}`}>
            {r.brand}
            {r.varian ? ` · ${r.varian}` : ""}
          </span>
        </div>
      ),
      className: "max-w-[24rem]",
    },
    {
      id: "lini",
      header: "Lini",
      sortable: true,
      accessor: (r) => r.lini,
      cell: (r) => <Badge variant="outline">{r.lini}</Badge>,
    },
    {
      id: "klas",
      header: "Klasifikasi",
      sortable: true,
      accessor: (r) => klasOf(r),
      cell: (r) => {
        const label = klasOf(r);
        if (!label) return <span className="text-muted-foreground text-xs">belum ada</span>;
        return (
          <span
            className={`block max-w-[18rem] truncate text-xs ${r.klasifikasiLengkap ? "" : "text-amber-600"}`}
            title={`${label}${r.klasifikasiLengkap ? "" : " — belum lengkap (Sub Class belum terdaftar di master)"}`}
          >
            {label}
          </span>
        );
      },
      className: "max-w-[18rem]",
    },
    {
      id: "hpp",
      header: "Harga Principal",
      align: "right",
      sortable: true,
      // Baris tanpa HPP diberi -1 supaya tidak berebut tempat dengan HPP Rp 0
      // saat diurutkan (Rp 0 tidak ada di data, tapi -1 tetap eksplisit).
      accessor: (r) => r.hpp ?? -1,
      cell: (r) =>
        r.hpp == null ? (
          <span className="text-muted-foreground text-xs">belum ada</span>
        ) : (
          <span className="whitespace-nowrap">{fmtRp(r.hpp)}</span>
        ),
    },
    {
      id: "margin",
      header: "Margin",
      align: "right",
      sortable: true,
      accessor: (r) => r.marginPct ?? -1,
      cell: (r) => <span className="whitespace-nowrap">{fmtPct(r.marginPct)}</span>,
    },
    {
      id: "pl",
      header: "Price List",
      align: "right",
      sortable: true,
      accessor: (r) => r.priceList,
      cell: (r) => <span className="whitespace-nowrap">{fmtRp(r.priceList)}</span>,
    },
    {
      id: "diskon",
      header: "Diskon Maks",
      align: "right",
      sortable: true,
      accessor: (r) => r.diskonMaks,
      cell: (r) => <span className="whitespace-nowrap">{Math.round(r.diskonMaks * 100)}%</span>,
    },
    {
      id: "nett",
      header: "Nett (lantai)",
      align: "right",
      sortable: true,
      accessor: (r) => r.hargaNett,
      cell: (r) => <span className="whitespace-nowrap">{fmtRp(r.hargaNett)}</span>,
    },
    {
      id: "ppn",
      header: "Nett + PPN",
      align: "right",
      sortable: true,
      accessor: (r) => r.nettPpn,
      cell: (r) => <span className="font-medium whitespace-nowrap">{fmtRp(r.nettPpn)}</span>,
    },
    {
      id: "status",
      header: "Status",
      sortable: true,
      accessor: (r) => `${r.status} ${r.adaOverride ? "1" : "0"}`,
      cell: (r) => (
        <span className="flex flex-col items-start gap-0.5 whitespace-nowrap">
          <Badge variant={r.status === "published" ? "secondary" : "outline"}>
            {r.status === "published" ? "Published" : "Draft"}
          </Badge>
          {r.adaOverride && (
            <span className="text-[10px] text-amber-600" title={`Harga handover: ${fmtRp(r.priceListAsli)} · diskon ${Math.round(r.diskonMaksAsli * 100)}%`}>
              disetel manual
            </span>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {ringkas && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Kpi label="SKU keagenan" value={fmtNum(ringkas.total)} sub={`periode ${ringkas.periode}`} />
          <Kpi
            label="Sudah ada HPP"
            value={fmtNum(ringkas.adaHpp)}
            sub={ringkas.tanpaHpp > 0 ? `${fmtNum(ringkas.tanpaHpp)} SKU belum` : "lengkap"}
            tone={ringkas.tanpaHpp > 0 ? "warn" : undefined}
          />
          <Kpi
            label="Margin agregat"
            value={fmtPct(ringkas.marginAgregat)}
            sub={`HPP ${fmtRpShort(ringkas.totalHpp)} vs PL ${fmtRpShort(ringkas.totalPriceList)}`}
          />
          <Kpi
            label="Klasifikasi lengkap"
            value={fmtNum(ringkas.klasifikasiLengkap)}
            sub={`${fmtNum(ringkas.total - ringkas.klasifikasiLengkap)} belum 4 level`}
            tone={ringkas.klasifikasiLengkap < ringkas.total ? "warn" : undefined}
          />
          <Kpi
            label="Dapat kode produk"
            value={fmtNum(ringkas.kepasangKode)}
            sub={`${fmtNum(ringkas.total - ringkas.kepasangKode)} belum kepasang`}
          />
        </div>
      )}

      {ringkas && ringkas.reviewTerbuka > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            <b>{fmtNum(ringkas.reviewTerbuka)} SKU</b> ditahan di antrean klasifikasi — kombinasi
            Kategori/Product Line/Class/Sub Class-nya belum terdaftar di master, jadi kodenya{" "}
            <b>tidak ditebak</b>. Lihat menu Klasifikasi Produk → antrean review (sumber “Master
            Kroscek PL H2-2026”) untuk diputuskan HoD Business.
          </span>
        </div>
      )}

      <DataTable
        columns={columns}
        data={data}
        getKey={(r) => String(r.rowNo)}
        searchPlaceholder="Cari nama / brand / kode…"
        pageSize={25}
        initialSort={{ id: "pl", dir: "desc" }}
        empty="Tidak ada SKU yang cocok dengan filter."
        onRowClick={(r) => setEdit(r)}
        toolbar={
          <>
            {canPublish && (
              <Button size="sm" variant="outline" disabled={busy || (ringkas?.draft ?? 0) === 0}
                      onClick={() => setKonfirmPublishAll(true)}>
                <Send /> Publish Semua Draft{ringkas?.draft ? ` (${fmtNum(ringkas.draft)})` : ""}
              </Button>
            )}
            <div className="flex flex-wrap gap-1 rounded-md border p-1">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={`rounded px-2 py-1 text-xs font-medium ${filter === f.key ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <ExportButton
              filename={`pricelist-setup-pricebook-${ringkas?.periode ?? "H2-2026"}`}
              data={data}
              columns={[
                { header: "Kode Produk", value: (r) => r.productKode ?? "" },
                { header: "Kode Sumber", value: (r) => r.kode ?? "" },
                { header: "Lini", value: (r) => r.lini },
                { header: "Brand", value: (r) => r.brand },
                { header: "Nama Final", value: (r) => namaOf(r) },
                { header: "Nama Handover", value: (r) => r.nama },
                { header: "Varian", value: (r) => r.varian ?? "" },
                { header: "Kemasan", value: (r) => r.kemasan ?? "" },
                { header: "Satuan", value: (r) => r.satuan ?? "" },
                { header: "Kategori", value: (r) => r.kategori ?? "" },
                { header: "Product Line", value: (r) => r.productLine ?? "" },
                { header: "Class", value: (r) => r.klas ?? "" },
                { header: "Sub Class", value: (r) => r.subClass ?? "" },
                { header: "Harga Principal (HPP)", value: (r) => r.hpp ?? "" },
                { header: "Margin", value: (r) => (r.marginPct == null ? "" : r.marginPct) },
                { header: "Price List", value: (r) => r.priceList },
                { header: "Diskon Maks", value: (r) => r.diskonMaks },
                { header: "Nett", value: (r) => r.hargaNett },
                { header: "Nett + PPN", value: (r) => r.nettPpn },
              ]}
            />
          </>
        }
      />
      <p className="text-muted-foreground mt-2 text-xs">
        Klik baris untuk menyetel HPP · Price List · Diskon Maks, lalu Publish agar tampil ke AM di
        tab Harga per Produk. Angka handover Direktur tidak pernah ditimpa — setelan disimpan sebagai
        override di atasnya, dan bisa dikembalikan kapan saja. Margin = 1 − HPP / Price List, dihitung.
      </p>

      <SetupHargaDialog
        row={edit}
        canPublish={canPublish}
        onOpenChange={(v) => !v && setEdit(null)}
        onSaved={() => { setEdit(null); router.refresh(); }}
      />

      <ConfirmDialog
        open={konfirmPublishAll}
        onOpenChange={setKonfirmPublishAll}
        title="Publish semua draft?"
        description={`${fmtNum(ringkas?.draft ?? 0)} baris harga akan langsung tampil ke Account Manager di tab Harga per Produk.`}
        confirmLabel="Publish Semua"
        onConfirm={() => void publishSemua()}
      />
    </div>
  );
}

// ── Dialog setel harga satu SKU ────────────────────────────────────────────
// Yang dikirim ke server hanya SELISIH dari angka handover: kalau kolomnya
// dikembalikan ke angka asli, override-nya di-NULL-kan, bukan disimpan ulang
// dengan nilai yang sama. Jadi "sudah disetel manual" selalu berarti benar-benar
// beda dari yang diserahkan Direktur.
function SetupHargaDialog({
  row, canPublish, onOpenChange, onSaved,
}: {
  row: PricebookSetupRow | null;
  canPublish: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        {row ? <SetupHargaBody row={row} canPublish={canPublish} onSaved={onSaved} /> : null}
      </DialogContent>
    </Dialog>
  );
}

const digit = (v: string) => v.replace(/[^\d]/g, "");

function SetupHargaBody({
  row, canPublish, onSaved,
}: {
  row: PricebookSetupRow;
  canPublish: boolean;
  onSaved: () => void;
}) {
  const [hpp, setHpp] = useState(row.hpp == null ? "" : String(Math.round(row.hpp)));
  const [pl, setPl] = useState(String(Math.round(row.priceList)));
  const [diskon, setDiskon] = useState(String(+(row.diskonMaks * 100).toFixed(2)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const nPl = Number(digit(pl) || 0);
  const nHpp = digit(hpp) === "" ? null : Number(digit(hpp));
  const nDiskon = Number(diskon.replace(",", ".")) / 100;
  const plBeda = nPl !== Math.round(row.priceListAsli);
  const diskonBeda = Math.abs(nDiskon - row.diskonMaksAsli) > 1e-9;
  const adaOverride = plBeda || diskonBeda;
  // Cermin rumus server (repo/pricebook.ts hargaEfektif): tanpa override angka
  // handover dipakai apa adanya, dengan override baru dihitung ulang.
  const nett = adaOverride ? Math.round(nPl * (1 - nDiskon)) : row.hargaNett;
  const ppn = adaOverride ? Math.round(nett * 1.11) : row.nettPpn;
  const margin = nHpp && nPl > 0 ? 1 - nHpp / nPl : null;

  async function kirim(url: string, body: unknown) {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(url, {
        method: url.endsWith("/setup") ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "operasi gagal");
      onSaved();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  const simpan = () =>
    void kirim("/api/pricebook/setup", {
      rowNo: row.rowNo,
      hpp: nHpp,
      priceListOverride: plBeda ? nPl : null,
      diskonOverride: diskonBeda ? +nDiskon.toFixed(4) : null,
    });

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          Setel Harga
          <Badge variant={row.status === "published" ? "secondary" : "outline"}>
            {row.status === "published" ? "Published" : "Draft"}
          </Badge>
        </DialogTitle>
        <DialogDescription>
          {row.namaFinal ?? row.nama} · {row.brand} · {row.lini}
          {row.productKode ? ` · ${row.productKode}` : ""}
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="s-hpp">Harga Principal (HPP)</Label>
            <Input id="s-hpp" inputMode="numeric" value={hpp === "" ? "" : Number(digit(hpp)).toLocaleString("id-ID")}
                   onChange={(e) => setHpp(digit(e.target.value))} placeholder="belum ada" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="s-pl">Price List</Label>
            <Input id="s-pl" inputMode="numeric" value={Number(digit(pl) || 0).toLocaleString("id-ID")}
                   onChange={(e) => setPl(digit(e.target.value))} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="s-diskon">Diskon Maks (%)</Label>
            <Input id="s-diskon" inputMode="decimal" value={diskon}
                   onChange={(e) => setDiskon(e.target.value)} />
          </div>
        </div>

        <div className="bg-muted/40 grid gap-2 rounded-lg border p-3 text-sm sm:grid-cols-2">
          <Baris label="Margin" nilai={margin == null ? "—" : fmtPct(margin)} />
          <Baris label="Nett (lantai)" nilai={fmtRp(nett)} />
          <Baris label="Nett + PPN 11%" nilai={fmtRp(ppn)} tebal />
          <Baris label="Angka handover" nilai={`${fmtRp(row.priceListAsli)} · ${Math.round(row.diskonMaksAsli * 100)}%`} />
        </div>

        {adaOverride && (
          <div className="flex items-start justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            <span>
              Harga ini akan disimpan sebagai <b>setelan manual</b> di atas angka handover Direktur.
              Nett &amp; PPN dihitung ulang dengan rumus resmi (Nett dari Price List, PPN dari Nett).
            </span>
            <Button size="sm" variant="ghost" className="shrink-0"
                    onClick={() => { setPl(String(Math.round(row.priceListAsli))); setDiskon(String(+(row.diskonMaksAsli * 100).toFixed(2))); }}>
              <RotateCcw /> Kembalikan
            </Button>
          </div>
        )}

        {err && <p className="text-sm text-red-600">{err}</p>}
      </DialogBody>

      <DialogFooter className="gap-2">
        {canPublish && row.status === "published" && (
          <Button variant="ghost" disabled={busy}
                  onClick={() => void kirim("/api/pricebook/setup/unpublish", { rowNos: [row.rowNo] })}>
            Tarik dari AM
          </Button>
        )}
        {canPublish && row.status !== "published" && (
          <Button variant="outline" disabled={busy}
                  onClick={() => void kirim("/api/pricebook/setup/publish", { rowNos: [row.rowNo] })}>
            <Send /> Publish baris ini
          </Button>
        )}
        <Button onClick={simpan} disabled={busy}>Simpan</Button>
      </DialogFooter>
    </>
  );
}

function Baris({ label, nilai, tebal }: { label: string; nilai: string; tebal?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className={`tabular-nums ${tebal ? "font-semibold" : ""}`}>{nilai}</span>
    </div>
  );
}

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
