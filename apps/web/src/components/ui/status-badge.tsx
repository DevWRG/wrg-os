import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Badge status SATU gaya untuk semua tabel (evaluasi menu 19 Nov 2026: tiap
// tabel menebak warna sendiri lewat variant Badge — di Orders "Menunggu
// diproses" dan "Terproses" berwarna sama, "Ditutup" merah seperti galat).
// Nada = arti, bukan teks: pemanggil memetakan statusnya ke salah satu nada.
export type NadaStatus = "netral" | "info" | "peringatan" | "sukses" | "bahaya";

const KELAS: Record<NadaStatus, string> = {
  netral: "border-transparent bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
  info: "border-transparent bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300",
  peringatan: "border-transparent bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  sukses: "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  bahaya: "border-transparent bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
};

export function StatusBadge({ nada, children, className }: { nada: NadaStatus; children: React.ReactNode; className?: string }) {
  return (
    <Badge variant="outline" className={cn(KELAS[nada], className)}>
      {children}
    </Badge>
  );
}

// Status SO Accurate (prod 23 Nov: Terproses, Ditutup, Menunggu diproses,
// Sebagian diproses, Draf). "Ditutup" = ditutup normal di Accurate, bukan galat.
export function nadaSoAccurate(s: string | null): NadaStatus {
  const t = (s ?? "").toLowerCase();
  if (t.includes("batal")) return "bahaya";
  if (t.includes("menunggu")) return "peringatan";
  if (t.includes("sebagian")) return "info";
  if (t === "terproses" || t.includes("selesai")) return "sukses";
  return "netral"; // Ditutup, Draf, lainnya
}

// Status DO/Surat Jalan Accurate (prod: Difaktur, Dikirim, Difaktur Sebagian).
export function nadaDoAccurate(s: string | null): NadaStatus {
  const t = (s ?? "").toLowerCase();
  if (t.includes("batal") || t.includes("retur")) return "bahaya";
  if (t.includes("sebagian")) return "peringatan";
  if (t.includes("difaktur") || t.includes("terima") || t.includes("selesai")) return "sukses";
  if (t.includes("kirim") || t.includes("transit")) return "info";
  return "netral";
}
