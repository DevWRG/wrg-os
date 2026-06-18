import cron from "node-cron";

import { db, isDbEnabled } from "./db.js";
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
import { runHodDaily } from "./repo/hodreminder.js";
import { generateRekap, generateResume } from "./repo/monitor.js";
import { syncAccurateInvoices, syncSalesOrders, syncDeliveryOrders, syncCustomers } from "./repo/accurateSync.js";
import { runPlanCheck, runReportCheck } from "./repo/compliance.js";
import { runNotifTua } from "./repo/notiftua.js";
import { runDailySummary } from "./repo/dailysummary.js";
import { runWeeklyReport } from "./repo/weeklyreport.js";
import { runDetectLeaveScan } from "./repo/detectleave.js";
import { runExtractCompetitor } from "./repo/extractcompetitor.js";
import { runWeekendBriefing } from "./repo/weekendbriefing.js";
import { runPolaKomunikasi } from "./repo/polakomunikasi.js";
import { runRefreshMembers } from "./repo/listmembers.js";
import { runNotifQuota } from "./repo/notifquota.js";

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

// Tanggal & jam WIB (UTC+7) untuk job monitor — selaras dgn endpoint /monitor/*/generate.
const wibNow = (): Date => new Date(Date.now() + 7 * 3600 * 1000);
const wibDate = (): string => wibNow().toISOString().slice(0, 10);
const wibJam = (): string => wibNow().toISOString().slice(11, 16);

// Hari kerja WIB: bukan Sabtu/Minggu & bukan libur (master_holiday).
async function isWorkday(): Promise<boolean> {
  const wib = wibNow();
  const dow = wib.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  try {
    const [h] = await db()`SELECT 1 FROM master_holiday WHERE tanggal = ${wib.toISOString().slice(0, 10)} LIMIT 1`;
    return !h;
  } catch {
    return true;
  }
}

export function startScheduler(): ScheduleStatus {
  const enabled = (process.env.AGENT_SCHEDULE_ENABLED ?? "false").toLowerCase() === "true";
  // Gating granular: reminder (AM note + HOD) bisa nyala SENDIRI tanpa memicu
  // A1-12 / monitor / accurate-sync (yang ikut AGENT_SCHEDULE_ENABLED).
  const remindersEnabled = (process.env.REMINDER_SCHEDULE_ENABLED ?? "false").toLowerCase() === "true";
  // accurate-sync (puller invoice, read-only ke API Accurate, tanpa kirim WA)
  // bisa nyala SENDIRI tanpa ikut menyalakan A1-12 / monitor.
  const accurateEnabled = (process.env.ACCURATE_SCHEDULE_ENABLED ?? "false").toLowerCase() === "true";
  // monitor rekap/resume (GENERATE-ONLY, simpan ke monitor_digest, tanpa kirim WA)
  // bisa nyala SENDIRI tanpa ikut menyalakan A1-12 / accurate-sync.
  const monitorEnabled = (process.env.MONITOR_SCHEDULE_ENABLED ?? "false").toLowerCase() === "true";
  // notif-tua (port notif_tua.sh) — KIRIM WA item TUA dari resume ke grup tujuan.
  // Nyala sendiri; hanya dijadwalkan bila NOTIF_TUA_TARGET di-set (anti broadcast
  // tak sengaja). Butuh resume → praktis berpasangan dgn monitor generate.
  const notifTuaEnabled = (process.env.NOTIF_TUA_ENABLED ?? "false").toLowerCase() === "true";
  // daily-summary (port wrg-daily.sh daily_summary) — KIRIM ringkasan harian AI
  // ke grup HOD Squad, 22:00 hari kerja. Nyala sendiri via flag.
  const dailySummaryEnabled = (process.env.DAILY_SUMMARY_ENABLED ?? "false").toLowerCase() === "true";
  // weekly-report (port cron_weekly_report.sh) — KPI mingguan ke HOD Squad, Senin 07:00.
  const weeklyReportEnabled = (process.env.WEEKLY_REPORT_ENABLED ?? "false").toLowerCase() === "true";
  // detect-leave (port detect_leave.sh) — scan grup HRD tiap 10 menit, deteksi
  // izin/sakit/cuti via LLM + approval admin. KIRIM WA ke grup HRD.
  const detectLeaveEnabled = (process.env.DETECT_LEAVE_ENABLED ?? "false").toLowerCase() === "true";
  // extract-competitor (port extract_competitor.sh) — LLM ekstrak sebutan
  // kompetitor dari activity_log → competitor_intel. TANPA kirim WA. Harian 23:00.
  const extractCompetitorEnabled = (process.env.EXTRACT_COMPETITOR_ENABLED ?? "false").toLowerCase() === "true";
  // weekend-briefing (port briefing_weekend.sh) — briefing direktur dari resume
  // 7 hari, GENERATE-ONLY (simpan kind='briefing', tanpa kirim WA). Sabtu & Minggu 07:00.
  const weekendBriefingEnabled = (process.env.WEEKEND_BRIEFING_ENABLED ?? "false").toLowerCase() === "true";
  // pola-komunikasi (port pola_komunikasi.sh) — profil pola per-grup, GENERATE-ONLY
  // (isi monitor_pola.content, feeds weekend-briefing), nightly 23:30.
  const polaEnabled = (process.env.POLA_ENABLED ?? "false").toLowerCase() === "true";
  // list-members (port list_members.sh, versi pragmatis) — sync roster master_user
  // → monitor_member. Tanpa WA/LLM. Harian 22:30.
  const listMembersEnabled = (process.env.LIST_MEMBERS_ENABLED ?? "false").toLowerCase() === "true";
  // notif-quota (port notif_quota.sh) — probe OpenRouter key/limit → alert owner WA. Tiap 6 jam.
  const notifQuotaEnabled = (process.env.NOTIF_QUOTA_ENABLED ?? "false").toLowerCase() === "true";
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
    enabled: enabled || remindersEnabled || accurateEnabled || monitorEnabled || notifTuaEnabled || dailySummaryEnabled || weeklyReportEnabled || detectLeaveEnabled || extractCompetitorEnabled || weekendBriefingEnabled || polaEnabled || listMembersEnabled || notifQuotaEnabled,
    timezone,
    jobs: jobs.map((j) => ({ id: j.id, expr: j.expr, valid: cron.validate(j.expr) })),
  };

  if (!enabled && !remindersEnabled && !accurateEnabled && !monitorEnabled && !notifTuaEnabled && !dailySummaryEnabled && !weeklyReportEnabled && !detectLeaveEnabled && !extractCompetitorEnabled && !weekendBriefingEnabled && !polaEnabled && !listMembersEnabled && !notifQuotaEnabled) {
    console.log("[scheduler] semua *_SCHEDULE/_ENABLED flag != true — tidak dijadwalkan");
    return status;
  }
  if (!isDbEnabled()) {
    console.warn("[scheduler] DATABASE_URL off — tidak dijadwalkan");
    status = { ...status, enabled: false };
    return status;
  }

  const live: string[] = [];
  // A1-12 hanya bila AGENT_SCHEDULE_ENABLED.
  if (enabled) for (const j of jobs) {
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

  // HOD daily reminder — rekap kepatuhan plan/report (08:30, setelah AM plan pagi).
  const hodExpr = process.env.HOD_REMINDER_CRON ?? "30 8 * * *";
  if (cron.validate(hodExpr)) {
    cron.schedule(
      hodExpr,
      async () => {
        const startedAt = new Date().toISOString();
        try {
          const r = await runHodDaily();
          console.log(`[scheduler] reminder-hod ok @ ${startedAt} ${JSON.stringify(r).slice(0, 200)}`);
        } catch (e) {
          console.error(`[scheduler] reminder-hod gagal @ ${startedAt}:`, e);
        }
      },
      { timezone },
    );
    live.push(`reminder-hod=${hodExpr}`);
  }

  // Compliance reminder per-grup (port plan_check/report_check) — ikut gating
  // reminder. plan-check skip non-hari-kerja; report-check weekend opt-in.
  const planCheckExpr = process.env.PLAN_CHECK_CRON ?? "15 8 * * *";
  if (cron.validate(planCheckExpr)) {
    cron.schedule(
      planCheckExpr,
      async () => {
        const startedAt = new Date().toISOString();
        try {
          if (!(await isWorkday())) {
            console.log(`[scheduler] plan-check skip (bukan hari kerja)`);
            return;
          }
          const r = await runPlanCheck();
          console.log(`[scheduler] plan-check @ ${startedAt} ${JSON.stringify(r)}`);
        } catch (e) {
          console.error(`[scheduler] plan-check gagal @ ${startedAt}:`, e);
        }
      },
      { timezone },
    );
    live.push(`plan-check=${planCheckExpr}`);
  }
  const reportCheckExpr = process.env.REPORT_CHECK_CRON ?? "30 20 * * *";
  if (cron.validate(reportCheckExpr)) {
    cron.schedule(
      reportCheckExpr,
      async () => {
        const startedAt = new Date().toISOString();
        try {
          const wd = await isWorkday();
          const r = await runReportCheck(wd);
          console.log(`[scheduler] report-check @ ${startedAt} wd=${wd} ${JSON.stringify(r)}`);
        } catch (e) {
          console.error(`[scheduler] report-check gagal @ ${startedAt}:`, e);
        }
      },
      { timezone },
    );
    live.push(`report-check=${reportCheckExpr}`);
  }

  // Monitor (port wrg-monitor) — rekap & resume GENERATE-ONLY (tidak kirim WA;
  // tidak mengganggu cron wrg-monitor lama). Cadence mengikuti legacy:
  // rekap 07/12/17/22 WIB, resume 14:00 & 22:10 WIB. Kirim WA (notif TUA) belum
  // diport — lihat docs/CUTOVER.md.
  const monitorJobs = [
    { label: "monitor-rekap", expr: process.env.MONITOR_REKAP_CRON ?? "0 7,12,17,22 * * *", run: () => generateRekap(wibDate(), wibJam()) },
    { label: "monitor-resume", expr: process.env.MONITOR_RESUME_CRON ?? "0 14 * * *", run: () => generateResume(wibDate(), wibJam()) },
    { label: "monitor-resume-malam", expr: process.env.MONITOR_RESUME2_CRON ?? "10 22 * * *", run: () => generateResume(wibDate(), wibJam()) },
  ];
  if (enabled || monitorEnabled) for (const j of monitorJobs) {
    if (!cron.validate(j.expr)) {
      console.error(`[scheduler] ${j.label} cron-expr tidak valid: "${j.expr}" — dilewati`);
      continue;
    }
    cron.schedule(
      j.expr,
      async () => {
        const startedAt = new Date().toISOString();
        try {
          const r = await j.run();
          console.log(`[scheduler] ${j.label} ok @ ${startedAt} ${JSON.stringify(r).slice(0, 200)}`);
        } catch (e) {
          console.error(`[scheduler] ${j.label} gagal @ ${startedAt}:`, e);
        }
      },
      { timezone },
    );
    live.push(`${j.label}=${j.expr}`);
  }

  // Sync Accurate (port sync_accurate.sh) — puller invoice, weekday 6× (jam kerja).
  // Read-only ke API Accurate; skip otomatis bila hari ini libur (master_holiday).
  const accExpr = process.env.ACCURATE_SYNC_CRON ?? "0 10,12,14,16,18,20 * * 1-5";
  if ((enabled || accurateEnabled) && cron.validate(accExpr)) {
    cron.schedule(
      accExpr,
      async () => {
        const startedAt = new Date().toISOString();
        try {
          const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
          const [h] = await db()`SELECT 1 FROM master_holiday WHERE tanggal = ${today} LIMIT 1`;
          if (h) {
            console.log(`[scheduler] accurate-sync skip (libur ${today})`);
            return;
          }
          const r = await syncAccurateInvoices({});
          console.log(`[scheduler] accurate-sync @ ${startedAt} ${JSON.stringify(r).slice(0, 200)}`);
          // Mirror sales-order/delivery-order TERBARU (recent-only) utk menu Orders/Shipments.
          try {
            const so = await syncSalesOrders({});
            const so2 = await syncDeliveryOrders({});
            const cu = await syncCustomers();
            console.log(`[scheduler] accurate-sync orders=${JSON.stringify(so)} shipments=${JSON.stringify(so2)} customers=${JSON.stringify(cu)}`);
          } catch (e2) {
            console.error(`[scheduler] accurate-sync orders/shipments gagal @ ${startedAt}:`, e2);
          }
        } catch (e) {
          console.error(`[scheduler] accurate-sync gagal @ ${startedAt}:`, e);
        }
      },
      { timezone },
    );
    live.push(`accurate-sync=${accExpr}`);
  }

  // notif-tua (port notif_tua.sh) — KIRIM WA item TUA dari resume terbaru ke
  // NOTIF_TUA_TARGET. Cadence legacy: 14:05 & 22:15 (sesudah resume 14:00/22:10).
  // Hanya dijadwalkan bila target di-set (hindari kirim tanpa tujuan jelas).
  const notifTuaTarget = process.env.NOTIF_TUA_TARGET ?? "";
  if ((enabled || notifTuaEnabled) && notifTuaTarget) {
    const tuaJobs = [
      { label: "notif-tua-siang", expr: process.env.NOTIF_TUA_CRON1 ?? "5 14 * * *" },
      { label: "notif-tua-malam", expr: process.env.NOTIF_TUA_CRON2 ?? "15 22 * * *" },
    ];
    for (const j of tuaJobs) {
      if (!cron.validate(j.expr)) {
        console.error(`[scheduler] ${j.label} cron-expr tidak valid: "${j.expr}" — dilewati`);
        continue;
      }
      cron.schedule(
        j.expr,
        async () => {
          const startedAt = new Date().toISOString();
          try {
            const r = await runNotifTua({});
            console.log(`[scheduler] ${j.label} @ ${startedAt} ${JSON.stringify(r).slice(0, 200)}`);
          } catch (e) {
            console.error(`[scheduler] ${j.label} gagal @ ${startedAt}:`, e);
          }
        },
        { timezone },
      );
      live.push(`${j.label}=${j.expr}`);
    }
  }

  // daily-summary (port wrg-daily.sh daily_summary) — ringkasan harian AI ke
  // HOD Squad, 22:00 hari kerja (skip Sabtu/Minggu & libur master_holiday).
  const dsExpr = process.env.DAILY_SUMMARY_CRON ?? "0 22 * * 1-5";
  if ((enabled || dailySummaryEnabled) && cron.validate(dsExpr)) {
    cron.schedule(
      dsExpr,
      async () => {
        const startedAt = new Date().toISOString();
        try {
          if (!(await isWorkday())) {
            console.log(`[scheduler] daily-summary skip (bukan hari kerja)`);
            return;
          }
          const r = await runDailySummary({});
          console.log(`[scheduler] daily-summary @ ${startedAt} ${JSON.stringify(r).slice(0, 200)}`);
        } catch (e) {
          console.error(`[scheduler] daily-summary gagal @ ${startedAt}:`, e);
        }
      },
      { timezone },
    );
    live.push(`daily-summary=${dsExpr}`);
  }

  // weekly-report (port cron_weekly_report.sh) — KPI minggu kerja lalu ke HOD
  // Squad, Senin 07:00. Tanpa skip workday (Senin pagi merangkum minggu lalu).
  const wrExpr = process.env.WEEKLY_REPORT_CRON ?? "0 7 * * 1";
  if ((enabled || weeklyReportEnabled) && cron.validate(wrExpr)) {
    cron.schedule(
      wrExpr,
      async () => {
        const startedAt = new Date().toISOString();
        try {
          const r = await runWeeklyReport({});
          console.log(`[scheduler] weekly-report @ ${startedAt} ${JSON.stringify(r).slice(0, 200)}`);
        } catch (e) {
          console.error(`[scheduler] weekly-report gagal @ ${startedAt}:`, e);
        }
      },
      { timezone },
    );
    live.push(`weekly-report=${wrExpr}`);
  }

  // detect-leave (port detect_leave.sh) — scan grup HRD tiap 10 menit.
  const dlExpr = process.env.DETECT_LEAVE_CRON ?? "*/10 * * * *";
  if ((enabled || detectLeaveEnabled) && cron.validate(dlExpr)) {
    cron.schedule(
      dlExpr,
      async () => {
        const startedAt = new Date().toISOString();
        try {
          const r = await runDetectLeaveScan({});
          if (r.scanned > 0 || r.pending_created > 0 || r.approved > 0 || r.rejected > 0) {
            console.log(`[scheduler] detect-leave @ ${startedAt} ${JSON.stringify(r).slice(0, 200)}`);
          }
        } catch (e) {
          console.error(`[scheduler] detect-leave gagal @ ${startedAt}:`, e);
        }
      },
      { timezone },
    );
    live.push(`detect-leave=${dlExpr}`);
  }

  // extract-competitor (port extract_competitor.sh) — harian 23:00, tanpa WA.
  const ecExpr = process.env.EXTRACT_COMPETITOR_CRON ?? "0 23 * * *";
  if ((enabled || extractCompetitorEnabled) && cron.validate(ecExpr)) {
    cron.schedule(
      ecExpr,
      async () => {
        const startedAt = new Date().toISOString();
        try {
          const r = await runExtractCompetitor({});
          console.log(`[scheduler] extract-competitor @ ${startedAt} ${JSON.stringify(r).slice(0, 200)}`);
        } catch (e) {
          console.error(`[scheduler] extract-competitor gagal @ ${startedAt}:`, e);
        }
      },
      { timezone },
    );
    live.push(`extract-competitor=${ecExpr}`);
  }

  // weekend-briefing (port briefing_weekend.sh) — Sabtu & Minggu 07:00, generate-only.
  const wbExpr = process.env.WEEKEND_BRIEFING_CRON ?? "0 7 * * 6,0";
  if ((enabled || weekendBriefingEnabled) && cron.validate(wbExpr)) {
    cron.schedule(
      wbExpr,
      async () => {
        const startedAt = new Date().toISOString();
        try {
          const r = await runWeekendBriefing({});
          console.log(`[scheduler] weekend-briefing @ ${startedAt} ${JSON.stringify(r).slice(0, 200)}`);
        } catch (e) {
          console.error(`[scheduler] weekend-briefing gagal @ ${startedAt}:`, e);
        }
      },
      { timezone },
    );
    live.push(`weekend-briefing=${wbExpr}`);
  }

  // pola-komunikasi (port pola_komunikasi.sh) — profil per-grup, nightly 23:30, generate-only.
  const polaExpr = process.env.POLA_CRON ?? "30 23 * * *";
  if ((enabled || polaEnabled) && cron.validate(polaExpr)) {
    cron.schedule(
      polaExpr,
      async () => {
        const startedAt = new Date().toISOString();
        try {
          const r = await runPolaKomunikasi({});
          console.log(`[scheduler] pola-komunikasi @ ${startedAt} ${JSON.stringify(r).slice(0, 200)}`);
        } catch (e) {
          console.error(`[scheduler] pola-komunikasi gagal @ ${startedAt}:`, e);
        }
      },
      { timezone },
    );
    live.push(`pola-komunikasi=${polaExpr}`);
  }

  // list-members (port list_members.sh, pragmatis) — sync roster → monitor_member, harian 22:30.
  const lmExpr = process.env.LIST_MEMBERS_CRON ?? "30 22 * * *";
  if ((enabled || listMembersEnabled) && cron.validate(lmExpr)) {
    cron.schedule(
      lmExpr,
      async () => {
        const startedAt = new Date().toISOString();
        try {
          const r = await runRefreshMembers({});
          console.log(`[scheduler] list-members @ ${startedAt} ${JSON.stringify(r).slice(0, 200)}`);
        } catch (e) {
          console.error(`[scheduler] list-members gagal @ ${startedAt}:`, e);
        }
      },
      { timezone },
    );
    live.push(`list-members=${lmExpr}`);
  }

  // notif-quota (port notif_quota.sh) — probe OpenRouter, alert owner bila bermasalah. Tiap 6 jam.
  const nqExpr = process.env.NOTIF_QUOTA_CRON ?? "0 */6 * * *";
  if ((enabled || notifQuotaEnabled) && cron.validate(nqExpr)) {
    cron.schedule(
      nqExpr,
      async () => {
        const startedAt = new Date().toISOString();
        try {
          const r = await runNotifQuota({});
          if (r.alerted || r.reason) console.log(`[scheduler] notif-quota @ ${startedAt} ${JSON.stringify(r).slice(0, 200)}`);
        } catch (e) {
          console.error(`[scheduler] notif-quota gagal @ ${startedAt}:`, e);
        }
      },
      { timezone },
    );
    live.push(`notif-quota=${nqExpr}`);
  }

  console.log(`[scheduler] aktif (TZ=${timezone}): ${live.join(", ") || "(tidak ada job valid)"}`);
  return status;
}
