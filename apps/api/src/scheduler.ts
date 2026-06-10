import cron from "node-cron";

import { isDbEnabled } from "./db.js";
import {
  runArWatch,
  runCollectionDrafter,
  runDistillationCascade,
  runPipelineAuthenticity,
  runAnomalyDetection,
  runSalesDocDrafter,
  runProductIntelligence,
} from "./repo/agents.js";

// Penjadwal agen in-process (Blueprint v2.3). Default MATI — aktif hanya bila
// AGENT_SCHEDULE_ENABLED=true. Tiap run tetap menulis ke audit_log via repo
// agen, jadi eksekusi terjadwal pun ter-governance & auditable (Layer 4).
//
// Cadence default mengikuti Blueprint: A1 (distillation cascade / rekap) tiap
// 5 jam; A2 (AR aging watch) tiap pagi 08:00. Override lewat env cron-expr.

interface JobDef {
  id: string;
  expr: string;
  run: () => Promise<unknown>;
}

export interface ScheduleStatus {
  enabled: boolean;
  timezone: string;
  jobs: { id: string; expr: string; valid: boolean }[];
}

let status: ScheduleStatus = { enabled: false, timezone: "", jobs: [] };

export function getScheduleStatus(): ScheduleStatus {
  return status;
}

const TZ = (): string => process.env.AGENT_CRON_TZ ?? "Asia/Jakarta";

export function startScheduler(): ScheduleStatus {
  const enabled = (process.env.AGENT_SCHEDULE_ENABLED ?? "false").toLowerCase() === "true";
  const timezone = TZ();
  const jobs: JobDef[] = [
    {
      id: "A1",
      expr: process.env.A1_CRON ?? "0 */5 * * *",
      run: () => runDistillationCascade({}),
    },
    {
      id: "A2",
      expr: process.env.A2_CRON ?? "0 8 * * *",
      run: () => runArWatch(),
    },
    {
      // A3 setelah A2 (08:30) — AR aging fresh dulu baru draft penagihan.
      id: "A3",
      expr: process.env.A3_CRON ?? "30 8 * * *",
      run: () => runCollectionDrafter({}),
    },
    {
      // A4 audit keaslian pipeline tiap pagi (09:00).
      id: "A4",
      expr: process.env.A4_CRON ?? "0 9 * * *",
      run: () => runPipelineAuthenticity(),
    },
    {
      // A5 deteksi anomali numerik (09:15, setelah audit pipeline).
      id: "A5",
      expr: process.env.A5_CRON ?? "15 9 * * *",
      run: () => runAnomalyDetection(),
    },
    {
      // A6 draft dokumen penjualan (10:00). Token tier HIGH — batch dibatasi.
      id: "A6",
      expr: process.env.A6_CRON ?? "0 10 * * *",
      run: () => runSalesDocDrafter({}),
    },
    {
      // A7 intelijen produk (10:30). Deterministik, murah (LOW).
      id: "A7",
      expr: process.env.A7_CRON ?? "30 10 * * *",
      run: () => runProductIntelligence(),
    },
  ];

  status = {
    enabled,
    timezone,
    jobs: jobs.map((j) => ({ id: j.id, expr: j.expr, valid: cron.validate(j.expr) })),
  };

  if (!enabled) {
    console.log("[scheduler] AGENT_SCHEDULE_ENABLED!=true — agen tidak dijadwalkan");
    return status;
  }
  if (!isDbEnabled()) {
    console.warn("[scheduler] DATABASE_URL off — agen tidak dijadwalkan");
    status = { ...status, enabled: false };
    return status;
  }

  const live: string[] = [];
  for (const j of jobs) {
    if (!cron.validate(j.expr)) {
      console.error(`[scheduler] ${j.id} cron-expr tidak valid: "${j.expr}" — dilewati`);
      continue;
    }
    cron.schedule(
      j.expr,
      async () => {
        const startedAt = new Date().toISOString();
        try {
          const r = await j.run();
          console.log(`[scheduler] ${j.id} ok @ ${startedAt} ${JSON.stringify(r).slice(0, 240)}`);
        } catch (e) {
          console.error(`[scheduler] ${j.id} gagal @ ${startedAt}:`, e);
        }
      },
      { timezone },
    );
    live.push(`${j.id}=${j.expr}`);
  }
  console.log(`[scheduler] aktif (TZ=${timezone}): ${live.join(", ") || "(tidak ada job valid)"}`);
  return status;
}
