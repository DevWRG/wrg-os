import { BarChart3, FileText, TrendingUp, Package2 } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const reports = [
  {
    icon: TrendingUp,
    title: "Sales Performance",
    description: "Penjualan per customer, brand, dan kategori produk.",
  },
  {
    icon: Package2,
    title: "Inventory Movement",
    description: "Pergerakan stok masuk-keluar per gudang.",
  },
  {
    icon: BarChart3,
    title: "Aging Receivables",
    description: "Piutang customer berdasarkan umur jatuh tempo.",
  },
  {
    icon: FileText,
    title: "Regulatory Compliance",
    description: "Status izin distribusi (IPAK) dan masa berlaku CDAKB.",
  },
];

export default function ReportsPage() {
  return (
    <>
      <PageHeader
        title="Reports"
        description="Kumpulan laporan operasional dan regulasi."
      />

      <div className="grid gap-4 md:grid-cols-2">
        {reports.map((r) => (
          <Card key={r.title} className="hover:bg-accent/50 transition-colors">
            <CardHeader className="flex flex-row items-start gap-3 space-y-0">
              <div className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-md">
                <r.icon className="size-5" />
              </div>
              <div className="flex-1">
                <CardTitle className="text-base">{r.title}</CardTitle>
                <CardDescription>{r.description}</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-muted-foreground text-xs">
                Generate / preview belum dihubungkan ke data riil.
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
