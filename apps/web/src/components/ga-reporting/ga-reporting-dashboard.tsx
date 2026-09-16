"use client";

import { useState } from "react";
import { Loader2, PenLine, Car, Wallet, Laptop, QrCode } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/dashboard/stat-card";
import { ExportButton } from "@/components/ui/export-button";

interface AtkBlock {
  available: boolean;
  current?: { active_items: number; low_stock_count: number };
  period?: {
    stock_in_qty: number;
    stock_out_qty: number;
    opname_count: number;
    opname_variance_qty: number;
    by_transaction_category: { barang: { stock_in_qty: number; stock_out_qty: number }; materai: { stock_in_qty: number; stock_out_qty: number } };
  };
}
interface KendaraanBlock {
  available: boolean;
  current?: { total_vehicles: number; due_service_count: number; due_stnk_count: number };
  period?: { bbm_liter: number; bbm_cost: number };
}
interface DanaOpsBlock {
  available: boolean;
  current?: { in_progress_count: number; outstanding_amount: number };
  period?: { realized_count: number; realized_amount: number };
}
interface ItAssetBlock {
  available: boolean;
  current?: { open_count: number; in_progress_count: number; breach_active_count: number; breach_active_critical_count: number };
  period?: { resolved_count: number; breach_resolved_late_count: number };
}
interface AssetTagBlock {
  available: boolean;
  current?: { total_active: number; belum_diaudit_count: number; ditemukan_count: number; hilang_count: number };
  period?: { audit_count: number };
}

export interface GaReportingData {
  range: { from: string; to: string };
  atk: AtkBlock;
  kendaraan: KendaraanBlock;
  dana_ops: DanaOpsBlock;
  it_asset: ItAssetBlock;
  asset_tag: AssetTagBlock;
}

const rp = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const num = (n: number) => new Intl.NumberFormat("id-ID").format(n);
const dmy = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};

function ModuleSection({ title, icon: Icon, available, children }: { title: string; icon: typeof PenLine; available: boolean; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-4" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {available ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
        ) : (
          <EmptyState
            title="Modul belum tersedia"
            description="Fitur sumber data ini belum di-merge ke lingkungan ini — dashboard akan otomatis terisi begitu modulnya tersedia."
          />
        )}
      </CardContent>
    </Card>
  );
}

interface ExportRow {
  modul: string;
  tersedia: string;
  ringkasan: string;
}

export function GaReportingDashboard({ initial }: { initial: GaReportingData | null }) {
  const [data, setData] = useState<GaReportingData | null>(initial);
  const [from, setFrom] = useState(initial?.range.from ?? "");
  const [to, setTo] = useState(initial?.range.to ?? "");
  const [loading, setLoading] = useState(false);

  async function apply() {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const res = await fetch(`/api/ga-reporting/summary?${qs}`, { cache: "no-store" });
      const d = (await res.json()) as GaReportingData;
      if (res.ok) setData(d);
    } finally {
      setLoading(false);
    }
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="text-muted-foreground py-16 text-center text-sm">
          Data tidak tersedia. Pastikan apps/api jalan & DATABASE_URL terhubung.
        </CardContent>
      </Card>
    );
  }

  const exportRows: ExportRow[] = [
    {
      modul: "ATK (F49 + F54 Materai)",
      tersedia: data.atk.available ? "Ya" : "Belum",
      ringkasan: data.atk.available
        ? `Item aktif: ${data.atk.current?.active_items ?? 0}, Stok rendah: ${data.atk.current?.low_stock_count ?? 0}, Masuk: ${data.atk.period?.stock_in_qty ?? 0}, Keluar: ${data.atk.period?.stock_out_qty ?? 0}`
        : "-",
    },
    {
      modul: "Kendaraan Operasional (F50)",
      tersedia: data.kendaraan.available ? "Ya" : "Belum",
      ringkasan: data.kendaraan.available
        ? `Total: ${data.kendaraan.current?.total_vehicles ?? 0}, Due service: ${data.kendaraan.current?.due_service_count ?? 0}, Due STNK: ${data.kendaraan.current?.due_stnk_count ?? 0}, BBM: ${rp(data.kendaraan.period?.bbm_cost ?? 0)}`
        : "-",
    },
    {
      modul: "Dana Ops / Petty Cash (F51)",
      tersedia: data.dana_ops.available ? "Ya" : "Belum",
      ringkasan: data.dana_ops.available
        ? `Berjalan: ${data.dana_ops.current?.in_progress_count ?? 0}, Belum direalisasi: ${rp(data.dana_ops.current?.outstanding_amount ?? 0)}, Direalisasi periode: ${rp(data.dana_ops.period?.realized_amount ?? 0)}`
        : "-",
    },
    {
      modul: "IT Asset & Issue Tracker (F52)",
      tersedia: data.it_asset.available ? "Ya" : "Belum",
      ringkasan: data.it_asset.available
        ? `Baru: ${data.it_asset.current?.open_count ?? 0}, Dikerjakan: ${data.it_asset.current?.in_progress_count ?? 0}, Breach aktif: ${data.it_asset.current?.breach_active_count ?? 0}, Breach telat (periode): ${data.it_asset.period?.breach_resolved_late_count ?? 0}`
        : "-",
    },
    {
      modul: "Stiker Aset & Tagging Audit (F53)",
      tersedia: data.asset_tag.available ? "Ya" : "Belum",
      ringkasan: data.asset_tag.available
        ? `Aset aktif: ${data.asset_tag.current?.total_active ?? 0}, Belum diaudit: ${data.asset_tag.current?.belum_diaudit_count ?? 0}, Hilang: ${data.asset_tag.current?.hilang_count ?? 0}`
        : "-",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">GA Reporting &amp; Analytics Dashboard</h1>
          <p className="text-muted-foreground text-sm">
            Konsolidasi 6 modul General Affairs · {dmy(data.range.from)} → {dmy(data.range.to)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="ga-from" className="text-muted-foreground text-xs">Dari</Label>
          <Input id="ga-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-card h-8 w-auto" />
          <Label htmlFor="ga-to" className="text-muted-foreground text-xs">Sampai</Label>
          <Input id="ga-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-card h-8 w-auto" />
          <Button size="sm" onClick={apply} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : null} Terapkan
          </Button>
          <ExportButton
            filename="ga-reporting-summary"
            columns={[
              { header: "Modul", value: (r: ExportRow) => r.modul },
              { header: "Tersedia", value: (r: ExportRow) => r.tersedia },
              { header: "Ringkasan", value: (r: ExportRow) => r.ringkasan },
            ]}
            data={exportRows}
          />
        </div>
      </div>

      <ModuleSection title="ATK Stock In/Out (F49 + F54 Materai)" icon={PenLine} available={data.atk.available}>
        <StatCard title="Item aktif" value={num(data.atk.current?.active_items ?? 0)} icon={PenLine} />
        <StatCard title="Stok rendah" value={num(data.atk.current?.low_stock_count ?? 0)} deltaTone={(data.atk.current?.low_stock_count ?? 0) > 0 ? "negative" : "neutral"} icon={PenLine} />
        <StatCard title="Stok masuk (periode)" value={num(data.atk.period?.stock_in_qty ?? 0)} icon={PenLine} />
        <StatCard title="Stok keluar (periode)" value={num(data.atk.period?.stock_out_qty ?? 0)} icon={PenLine} />
        <StatCard title="Opname (periode)" value={num(data.atk.period?.opname_count ?? 0)} icon={PenLine} />
        <StatCard
          title="Selisih opname (periode)"
          value={num(data.atk.period?.opname_variance_qty ?? 0)}
          deltaTone={(data.atk.period?.opname_variance_qty ?? 0) < 0 ? "negative" : "neutral"}
          icon={PenLine}
        />
        <StatCard title="Barang keluar (periode)" value={num(data.atk.period?.by_transaction_category.barang.stock_out_qty ?? 0)} icon={PenLine} />
        <StatCard title="Materai keluar (periode)" value={num(data.atk.period?.by_transaction_category.materai.stock_out_qty ?? 0)} icon={PenLine} />
      </ModuleSection>

      <ModuleSection title="Kendaraan Operasional (F50)" icon={Car} available={data.kendaraan.available}>
        <StatCard title="Total kendaraan" value={num(data.kendaraan.current?.total_vehicles ?? 0)} icon={Car} />
        <StatCard title="Due service" value={num(data.kendaraan.current?.due_service_count ?? 0)} deltaTone={(data.kendaraan.current?.due_service_count ?? 0) > 0 ? "negative" : "neutral"} icon={Car} />
        <StatCard title="Due STNK" value={num(data.kendaraan.current?.due_stnk_count ?? 0)} deltaTone={(data.kendaraan.current?.due_stnk_count ?? 0) > 0 ? "negative" : "neutral"} icon={Car} />
        <StatCard title="Biaya BBM (periode)" value={rp(data.kendaraan.period?.bbm_cost ?? 0)} icon={Car} />
      </ModuleSection>

      <ModuleSection title="Dana Ops / Petty Cash (F51)" icon={Wallet} available={data.dana_ops.available}>
        <StatCard title="Sedang berjalan" value={num(data.dana_ops.current?.in_progress_count ?? 0)} icon={Wallet} />
        <StatCard title="Belum direalisasi" value={rp(data.dana_ops.current?.outstanding_amount ?? 0)} deltaTone={(data.dana_ops.current?.outstanding_amount ?? 0) > 0 ? "negative" : "neutral"} icon={Wallet} />
        <StatCard title="Direalisasi (periode)" value={num(data.dana_ops.period?.realized_count ?? 0)} icon={Wallet} />
        <StatCard title="Nilai realisasi (periode)" value={rp(data.dana_ops.period?.realized_amount ?? 0)} icon={Wallet} />
      </ModuleSection>

      <ModuleSection title="IT Asset & Issue Tracker (F52)" icon={Laptop} available={data.it_asset.available}>
        <StatCard title="Tiket baru" value={num(data.it_asset.current?.open_count ?? 0)} icon={Laptop} />
        <StatCard title="Sedang dikerjakan" value={num(data.it_asset.current?.in_progress_count ?? 0)} icon={Laptop} />
        <StatCard
          title="Breach aktif"
          value={num(data.it_asset.current?.breach_active_count ?? 0)}
          deltaTone={(data.it_asset.current?.breach_active_count ?? 0) > 0 ? "negative" : "neutral"}
          icon={Laptop}
        />
        <StatCard
          title="Breach kritis aktif"
          value={num(data.it_asset.current?.breach_active_critical_count ?? 0)}
          deltaTone={(data.it_asset.current?.breach_active_critical_count ?? 0) > 0 ? "negative" : "neutral"}
          icon={Laptop}
        />
        <StatCard title="Selesai (periode)" value={num(data.it_asset.period?.resolved_count ?? 0)} icon={Laptop} />
        <StatCard
          title="Breach telat selesai (periode)"
          value={num(data.it_asset.period?.breach_resolved_late_count ?? 0)}
          deltaTone={(data.it_asset.period?.breach_resolved_late_count ?? 0) > 0 ? "negative" : "neutral"}
          icon={Laptop}
        />
      </ModuleSection>

      <ModuleSection title="Stiker Aset & Tagging Audit (F53)" icon={QrCode} available={data.asset_tag.available}>
        <StatCard title="Aset aktif" value={num(data.asset_tag.current?.total_active ?? 0)} icon={QrCode} />
        <StatCard
          title="Belum diaudit"
          value={num(data.asset_tag.current?.belum_diaudit_count ?? 0)}
          deltaTone={(data.asset_tag.current?.belum_diaudit_count ?? 0) > 0 ? "negative" : "neutral"}
          icon={QrCode}
        />
        <StatCard title="Ditemukan" value={num(data.asset_tag.current?.ditemukan_count ?? 0)} icon={QrCode} />
        <StatCard title="Hilang" value={num(data.asset_tag.current?.hilang_count ?? 0)} deltaTone={(data.asset_tag.current?.hilang_count ?? 0) > 0 ? "negative" : "neutral"} icon={QrCode} />
        <StatCard title="Audit (periode)" value={num(data.asset_tag.period?.audit_count ?? 0)} icon={QrCode} />
      </ModuleSection>
    </div>
  );
}
