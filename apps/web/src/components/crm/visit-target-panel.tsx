import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// F16 CRM Fase 1 — capaian target kunjungan mingguan per AM (default 20/minggu,
// 6 di antaranya prospek baru; per-AM bisa di-override lewat tabel visit_target).
//
// Server component: datanya sudah di-scope row-level oleh api (/visits/kpi), jadi
// AM cuma lihat barisnya sendiri dan HoD cuma timnya — tak ada filter di klien.

export interface AmVisitProgress {
  am_id: string;
  nama: string | null;
  cabang: string | null;
  visits: number;
  visits_geotag: number;
  visits_unbound: number;
  new_prospects: number;
  target: number;
  new_target: number;
  pct: number;
}

export interface VisitTargetKpi {
  iso_year: number;
  iso_week: number;
  week_start: string;
  target_default: number;
  new_target_default: number;
  per_am: AmVisitProgress[];
  on_track: number;
}

export interface TimelinessKpi {
  window_days: number;
  total: number;
  on_time: number;
  pct: number | null;
  target_pct: number;
}

// Ambang warna sengaja longgar di tengah: 100% = hijau, ≥60% = kuning (masih
// bisa dikejar sisa minggu), di bawah itu merah.
function tone(pct: number) {
  if (pct >= 100) return { bar: "bg-emerald-500 dark:bg-emerald-400", text: "text-emerald-600 dark:text-emerald-400" };
  if (pct >= 60) return { bar: "bg-amber-500 dark:bg-amber-400", text: "text-amber-600 dark:text-amber-400" };
  return { bar: "bg-rose-500 dark:bg-rose-400", text: "text-rose-600 dark:text-rose-400" };
}

const fmtWeekStart = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};

export function TimelinessCard({ kpi }: { kpi: TimelinessKpi }) {
  const pct = kpi.pct;
  const ok = pct !== null && pct >= kpi.target_pct;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-muted-foreground text-sm font-medium">Timeliness input ≤48 jam</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={cn("text-xl font-semibold tabular-nums", pct === null ? "" : ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
          {pct === null ? "—" : `${pct}%`}
        </div>
        <p className="text-muted-foreground text-xs">
          {pct === null
            ? `belum ada aktivitas ${kpi.window_days} hari terakhir`
            : `${kpi.on_time}/${kpi.total} aktivitas · target ≥${kpi.target_pct}% · ${kpi.window_days} hari terakhir`}
        </p>
        <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
          <div
            className={cn("h-full rounded-full", ok ? "bg-emerald-500 dark:bg-emerald-400" : "bg-amber-500 dark:bg-amber-400")}
            style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%` }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

export function WeeklyTargetCard({ kpi }: { kpi: VisitTargetKpi }) {
  const total = kpi.per_am.length;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-muted-foreground text-sm font-medium">Target minggu ini</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-xl font-semibold tabular-nums">
          {kpi.on_track}
          <span className="text-muted-foreground text-base font-normal">/{total} AM</span>
        </div>
        <p className="text-muted-foreground text-xs">
          sudah ≥{kpi.target_default} kunjungan · minggu {kpi.iso_week} ({fmtWeekStart(kpi.week_start)})
        </p>
      </CardContent>
    </Card>
  );
}

export function VisitTargetTable({ kpi }: { kpi: VisitTargetKpi }) {
  if (kpi.per_am.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">
          Capaian kunjungan per AM — minggu {kpi.iso_week}
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Target {kpi.target_default} kunjungan/minggu, {kpi.new_target_default} di antaranya prospek baru
          (belum dikunjungi 90 hari terakhir). Capaian dihitung dari kunjungan yang{" "}
          <span className="font-medium">dilaporkan</span>; kolom{" "}
          <span className="font-medium">Geotag</span> menunjukkan berapa di antaranya berkoordinat.{" "}
          <span className="font-medium">Tak terikat</span> = laporan yang masuk tapi tak tersambung ke
          rencana (paling sering karena tanggal laporan beda dari tanggal rencana) — kerjanya tercatat,
          hanya belum terhitung sebagai capaian.
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left text-xs">
                <th className="pb-2 font-medium">AM</th>
                <th className="pb-2 font-medium">Cabang</th>
                <th className="pb-2 text-right font-medium">Kunjungan</th>
                <th className="pb-2 text-right font-medium">Geotag</th>
                <th className="pb-2 text-right font-medium">Tak terikat</th>
                <th className="pb-2 pl-3 font-medium">Progress</th>
                <th className="pb-2 text-right font-medium">Prospek baru</th>
              </tr>
            </thead>
            <tbody>
              {kpi.per_am.map((a) => {
                const t = tone(a.pct);
                const newOk = a.new_prospects >= a.new_target;
                return (
                  <tr key={a.am_id} className="border-border/60 border-b last:border-0">
                    <td className="py-2 font-medium">{a.nama ?? a.am_id}</td>
                    <td className="text-muted-foreground py-2">{a.cabang ?? "—"}</td>
                    <td className="py-2 text-right tabular-nums">
                      {a.visits}
                      <span className="text-muted-foreground">/{a.target}</span>
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {a.visits > 0 ? (
                        <span className={a.visits_geotag === 0 ? "text-amber-600 dark:text-amber-400" : undefined}>
                          {a.visits_geotag}
                          <span className="text-muted-foreground">/{a.visits}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {a.visits_unbound > 0 ? (
                        <span
                          className="text-amber-600 dark:text-amber-400"
                          title="Laporan tercatat di activity_log tapi tak terikat rencana — biasanya tanggal laporan beda dari tanggal rencana. Kerjanya ada, capaiannya belum terhitung."
                        >
                          {a.visits_unbound}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="w-[34%] py-2 pl-3">
                      <div className="flex items-center gap-2">
                        <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
                          <div className={cn("h-full rounded-full", t.bar)} style={{ width: `${Math.min(100, a.pct)}%` }} />
                        </div>
                        {/* 0% dengan laporan tak terikat BUKAN "tak lapor" — jangan
                            dirender sebagai nol yang mulus (lihat catatan
                            visits_unbound di repo/visit.ts). */}
                        {a.visits === 0 && a.visits_unbound > 0 ? (
                          <span
                            className="w-10 text-right text-xs tabular-nums text-amber-600 dark:text-amber-400"
                            title={`${a.visits_unbound} laporan masuk tapi tak terikat rencana — bukan berarti tidak melapor.`}
                          >
                            0%*
                          </span>
                        ) : (
                          <span className={cn("w-10 text-right text-xs tabular-nums", t.text)}>{a.pct}%</span>
                        )}
                      </div>
                    </td>
                    <td className={cn("py-2 text-right tabular-nums", newOk ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                      {a.new_prospects}
                      <span className="text-muted-foreground">/{a.new_target}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
