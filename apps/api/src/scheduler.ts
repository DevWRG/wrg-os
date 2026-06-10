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
  runSentimentExtraction,
  runSpiderNetwork,
  runExecutiveSynthesis,
  runCoachingSynthesis,
  runPeopleAnalytics,
} from "./repo/agents.js";
import { runReminders } from "./repo/reminder.js";

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
    {
      // A8 anotasi sentiment/entity wa_message (tiap 6 jam, ikut arus pesan).
      id: "A8",
      expr: process.env.A8_CRON ?? "0 */6 * * *",
      run: () => runSentimentExtraction({}),
    },
    {
      // A9 analisis jaringan relasi (11:00, setelah anotasi A8 terkumpul).
      id: "A9",
      expr: process.env.A9_CRON ?? "0 11 * * *",
      run: () => runSpiderNetwork({}),
    },
    {
      // A10 briefing eksekutif (07:30 — capstone, merangkum semalam + pagi).
      id: "A10",
      expr: process.env.A10_CRON ?? "30 7 * * *",
      run: () => runExecutiveSynthesis({}),
    },
    {
      // A11 sintesis coaching per AM — bulanan (tgl 1, 07:00).
      id: "A11",
      expr: process.env.A11_CRON ?? "0 7 1 * *",
      run: () => runCoachingSynthesis({}),
    },
    {
      // A12 people analytics — bulanan (tgl 1, 07:30, setelah A11).
      id: "A12",
      expr: process.env.A12_CRON ?? "30 7 1 * *",
      run: () => runPeopleAnalytics(),
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

  // Reminder CRM (fitur, bukan Blueprint agent → dijadwalkan langsung, tidak
  // masuk daftar agen). H pagi 07:00 + heads-up H-1 sore 17:00.
  const reminderJobs = [
    { label: "reminder-h", expr: process.env.REMINDER_H_CRON ?? "0 7 * * *", mode: "h" as const },
    { label: "reminder-h-1", expr: process.env.REMINDER_HMINUS1_CRON ?? "0 17 * * *", mode: "h-minus-1" as const },
  ];
  for (const j of reminderJobs) {
    if (!cron.validate(j.expr)) {
      console.error(`[scheduler] ${j.label} cron-expr tidak valid: "${j.expr}" — dilewati`);
      continue;
    }
    cron.schedule(
      j.expr,
      async () => {
        const startedAt = new Date().toISOString();
        try {
          const r = await runReminders(j.mode);
          console.log(`[scheduler] ${j.label} ok @ ${startedAt} ${JSON.stringify(r).slice(0, 200)}`);
        } catch (e) {
          console.error(`[scheduler] ${j.label} gagal @ ${startedAt}:`, e);
        }
      },
      { timezone },
    );
    live.push(`${j.label}=${j.expr}`);
  }

  console.log(`[scheduler] aktif (TZ=${timezone}): ${live.join(", ") || "(tidak ada job valid)"}`);
  return status;
}
