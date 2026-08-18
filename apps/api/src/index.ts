import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { Context } from "hono";
import type { EventEnvelope } from "@wrg/types";
import { isEventEnvelope } from "./envelope.js";
import { parsePlan } from "./parsers/plan.js";
import { parseReport } from "./parsers/report.js";
import { matchCustomer, type PlanCandidate } from "./parsers/fuzzy.js";
import { isDbEnabled, pingDb } from "./db.js";
import { waPreflight, sendViaWaGateway, type WaSendResult } from "./wasend.js";
import { processUnprocessed, isInboundEnabled } from "./repo/inbound.js";
import { syncAccurateInvoices, syncVendors, syncItems, syncSalesOrders, syncDeliveryOrders, syncCustomers, syncSalesOrderItems, syncDeliveryOrderItems, getDeliveryOrderItems, getSalesOrderItems, getVendorDetail, accurateConfigured } from "./repo/accurateSync.js";
import { mirrorFreshness } from "./repo/mirror-health.js";
import { insertAuditEvent } from "./repo/audit.js";
import { upsertDealsFromPlan, logReportToDeals, getPipeline, getPipelineReport, getPipelineLeaderboard, transitionStage, DealError, listPendingLosses, decideLoss, getDealTimeline, createDeal, updateDeal, deleteDeal } from "./repo/deal.js";
import { enqueueAmbiguous, listHitl, resolveHitl } from "./repo/hitl.js";
import { insertRekap, insertResume, getDigestHistory, getDigestInsights } from "./repo/digest.js";
import { getDashboardStats } from "./repo/stats.js";
import { getCustomers } from "./repo/customer.js";
import { listAccounts, getAccount, upsertAccountFields, createContact, updateContact, deleteContact, listOwnerCandidates } from "./repo/account.js";
import {
  ingestInvoices,
  ingestAccurateWebhook,
  getAging,
  arAgingByCustomer,
  invoiceDetail,
  type InvoiceInput,
  type AccurateInvoice,
} from "./repo/ar.js";
import {
  runArWatch,
  runDistillationCascade,
  runCollectionDrafter,
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
import {
  listCollectionDrafts,
  approveCollectionDraft,
  sendCollectionDraft,
  cancelCollectionDraft,
} from "./repo/collection.js";
import {
  listSalesDocs,
  approveSalesDoc,
  sendSalesDoc,
  cancelSalesDoc,
} from "./repo/salesdoc.js";
import { getProductIntelligence } from "./repo/product.js";
import { listAnnotations } from "./repo/sentiment.js";
import { getNetworkInput, computeNetwork } from "./repo/network.js";
import { listBriefings } from "./repo/executive.js";
import {
  getWatchBoard, formatHodWatchWa, findMetricDef, upsertWatchMetric, deleteWatchMetric,
  type WatchStatus,
} from "./repo/watchpoint.js";
import {
  getWeeklyBoard, listWeeks, snapshotWeek, upsertWeeklyMetric, deleteWeeklyMetric,
  currentWeek, formatWeeklyHodWa,
} from "./repo/watchpoint-weekly.js";
import { buildWeeklyDeck, weeklyDeckFilename } from "./repo/watchpoint-pptx.js";
import {
  effectivePermissions, listFeatures, listGroups, getGroup, createGroup, updateGroup,
  deleteGroup, setPermissions, setMembers, copyPermissions, syncFeatures,
  type PermRow, type FeatureInput,
} from "./repo/rbac.js";
import { listTerritory, createTerritory, updateTerritory, deleteTerritory } from "./repo/territory.js";
import { listPricelist, upsertPricelist, publishPricelist, unpublishPricelist, deletePricelist, type PricelistInput } from "./repo/pricelist.js";
import {
  listItems as listPricebookItems, summary as pricebookSummary,
  outsideKeagenan, periodeList as pricebookPeriode,
  listSetup as listPricebookSetup, setupSummary as pricebookSetupSummary,
  updateSetupRow as updatePricebookSetupRow, publishSetup as publishPricebookSetup,
  unpublishSetup as unpublishPricebookSetup, listPublishedKeagenan,
  type SetupPatch as PricebookSetupPatch,
} from "./repo/pricebook.js";
import { pricelistPdf } from "./repo/pricelist-pdf.js";
import {
  taxonomy as klasifikasiTaxonomy, summary as klasifikasiSummary,
  listCodes as listKlasifikasiCodes, nextKode as nextKlasifikasiKode,
  createCode as createKlasifikasiCode, upsertNode as upsertKlasifikasiNode,
  deleteNode as deleteKlasifikasiNode, listReview as listKlasifikasiReview,
  setReviewStatus as setKlasifikasiReviewStatus,
  selesaikanReview as selesaikanKlasifikasiReview, subClassPilihan as klasifikasiSubClassPilihan,
  type CodeInput as KlasifikasiCodeInput, type NodeInput as KlasifikasiNodeInput,
  type Level as KlasifikasiLevel,
} from "./repo/klasifikasi.js";
import { master as ksoMaster } from "./repo/kso.js";
import { listCoachingNotes } from "./repo/coaching.js";
import { getLatestCoachingNotes, computePeopleAnalytics } from "./repo/people.js";
import { createVisit, getVisit, listVisits, visitKpi, visitSummary } from "./repo/visit.js";
import { upsertDailyTodo, listTodos, markTodoReported } from "./repo/todo.js";
import { upsertUser, listUsers, upsertTerritory, listTerritories, updateUserCabang, updateUserGolongan } from "./repo/master.js";
import { GOLONGAN, GOLONGAN_LABEL, TARGET_CUSTOMER_MINIMUM, isGolongan } from "./lib/npk-golongan.js";
import { listTargets, upsertTargets, listCabangTargets, upsertCabangTargets, listAmTargets, upsertAmTargets, listAmCandidates, deleteAmTarget } from "./repo/sales-target.js";
import {
  upsertHoliday,
  listHolidays,
  createLeave,
  listLeave,
  isOnLeave,
  detectLeave,
  deleteHoliday,
  deleteLeave,
  updateLeave,
  listPendingLeave,
  decidePendingLeave,
} from "./repo/leave.js";
import { recordCompetitor, listCompetitor, competitorSummary } from "./repo/competitor.js";
import {
  defaultRange,
  parseRange,
  reportSummary,
  reportPerOrang,
  reportCompliance,
  reportPerDivisi,
  reportPerCabang,
  reportPerHod,
  reportDailyTrend,
  reportDrilldown,
  reportDetailAll,
  reportRemindersPending,
  pushReminderToAm,
  reportCalendar,
  reportCalendarDay,
} from "./repo/plandash.js";
import { salesRange, reportRevenue, reportSalesAr, salesOverview, customersRevenue, customerMonthly, dormantCustomers, churnCustomers, targetPacing, reportSalesPerformance } from "./repo/sales.js";
import { streamRange, reportRevenueByStream } from "./repo/revenue-stream.js";
import { resolveScope } from "./repo/access-scope.js";
import { getRaportList, getRaportDetail } from "./repo/raport.js";
import { generateRaportNarrative, runRaportNarrative } from "./repo/raportnarrative.js";
import {
  analyticsOverview,
  analyticsPerAm,
  analyticsPerAmDrilldown,
  analyticsPerProduk,
  analyticsPerPengadaan,
  analyticsPerCabang,
  analyticsPerCustomer,
  analyticsTrending,
  getMyArAging,
} from "./repo/sales-analytics.js";
import { listViews, saveView, deleteView, listAlerts, createAlert, deleteAlert, updateAlert, listAlertTargets } from "./repo/sales-analytics-config.js";
import { execCommand, execAmRadar, execOutletMatrix, execDormantIntel, execKpiBaseline, execRotation, execGrowthLevers } from "./repo/exec-dashboard.js";
import { evaluateSalesAlerts } from "./repo/sales-analytics-alert-eval.js";
import { computeNpk, getNpkScores, getNpkDetail, currentPeriod, type Period } from "./repo/npk.js";
import { computeNpkAm, getNpkAmScores, getNpkAmDetail } from "./repo/npk-am.js";
import {
  getInsentifSelf, getInsentifList, getInsentifDetail,
  computePeriode as computeInsentifPeriode,
} from "./repo/insentif.js";
import { listDepartments, listEmployees, getEmployee, getRaciMatrix, getMeasurements, saveMeasurements, createEmployee, updateEmployee, deleteEmployee, replaceEmployeeDetail, getVoiceAggregate, getHodResolution, getOrgReporting, populateHodKey, getHods, type MeasurementInput, type EmployeeWrite, type SpineDetail } from "./repo/employee-spine.js";
import { upsertMembers, listMembers, upsertDigests, listDigest, digestStats, upsertPola, listPola, generateRekap, generateResume, type MonitorMemberInput, type DigestInput, type PolaInput } from "./repo/monitor.js";
import { runNotifTua } from "./repo/notiftua.js";
import { runDailySummary } from "./repo/dailysummary.js";
import { runWeeklyReport } from "./repo/weeklyreport.js";
import { runDetectLeaveScan } from "./repo/detectleave.js";
import { runExtractCompetitor } from "./repo/extractcompetitor.js";
import { runWeekendBriefing } from "./repo/weekendbriefing.js";
import { runPolaKomunikasi } from "./repo/polakomunikasi.js";
import { runRefreshMembers } from "./repo/listmembers.js";
import { runNotifQuota } from "./repo/notifquota.js";
import {
  upsertCustomers,
  upsertBranches,
  upsertItems,
  listMirror,
  listSalesOrders,
  listDeliveryOrders,
} from "./repo/accurateMirror.js";
import { listWarehouses, listStockBranch, stockBranchSummary } from "./repo/stock-branch.js";
import { listStockBatch, stockBatchSummary, runEdWatch } from "./repo/stock-batch.js";
import { recordDelivery, recordEmail, recordAlert, listLogs } from "./repo/logs.js";
import { renderSalesDocHtml, renderBriefingHtml } from "./repo/exportdoc.js";
import {
  createApprovalRequest,
  listApprovalRequests,
  getApprovalRequest,
  listChainConfig,
  updateChainConfig,
  notifyCurrentStep,
  getAttachmentFile,
} from "./repo/approval.js";
import {
  generateSuggestions,
  listSuggestions,
  updateSuggestion,
  dismissSuggestion,
  submitSuggestion,
  listBufferConfig,
  upsertBufferConfig,
} from "./repo/forecast.js";
import { runHodDaily } from "./repo/hodreminder.js";
import {
  createReminder,
  updateReminder,
  deleteReminder,
  listReminders,
  runReminders,
  type ReminderMode,
} from "./repo/reminder.js";
import {
  ingestWaMessages,
  ingestOpenclawMessages,
  type WaMessageInput,
  type OpenclawRecord,
} from "./repo/wa.js";
import { aiBaseUrl, callAi } from "./ai.js";
import { startScheduler, getScheduleStatus } from "./scheduler.js";
import { signJwt, verifyJwt } from "./auth.js";
import { verifyCredentials, createUser, countUsers, listAppUsers, setUserPassword, updateAppUser, deleteAppUser, getAppUserById, createUserFromRoster, generatePassword, changeOwnPassword } from "./repo/users.js";

const app = new Hono();

// Selalu balas JSON saat error / route tak ada — supaya BFF & client tak pernah
// dapat body kosong/HTML (penyebab "Unexpected end of JSON input" di klien).
app.onError((err, c) => {
  console.error("[api] unhandled:", err);
  const msg = err instanceof Error ? err.message : "internal error";
  return c.json({ error: msg }, 500);
});
app.notFound((c) => c.json({ error: `route tak ada: ${c.req.method} ${c.req.path}` }, 404));

// Auth enforcement (opsional, default MATI). Saat AUTH_ENABLED=true, semua
// endpoint butuh otorisasi KECUALI: /health, /auth/*, /webhooks/* (punya
// secret sendiri). Diterima: x-service-token (BFF tepercaya) ATAU Bearer JWT.
const authEnabled = (): boolean => (process.env.AUTH_ENABLED ?? "").toLowerCase() === "true";
function authExempt(path: string): boolean {
  return path === "/health" || path.startsWith("/auth/") || path.startsWith("/webhooks/");
}
app.use("*", async (c, next) => {
  if (!authEnabled() || authExempt(c.req.path)) return next();
  const svc = process.env.API_SERVICE_TOKEN;
  if (svc && c.req.header("x-service-token") === svc) return next();
  const authz = c.req.header("authorization") ?? "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7) : "";
  if (token && verifyJwt(token)) return next();
  return c.json({ error: "unauthorized" }, 401);
});

app.get("/health", async (c) => {
  const db = isDbEnabled() ? (await pingDb()) ? "ok" : "down" : "disabled";
  return c.json({ status: "ok", service: "wrg-api", db });
});

// Kesegaran mirror Accurate. Sengaja BALIKAN 503 saat basi supaya bisa dipantau
// uptime-checker biasa tanpa parsing JSON — kegagalan sync itu senyap, tak ada
// yang error, angkanya cuma diam-diam kurang.
app.get("/health/mirror", async (c) => {
  const h = await mirrorFreshness();
  return c.json(h, h.ok ? 200 : 503);
});

// Status wiring gateway WA — TIDAK kirim pesan. ?probe=1 → cek konektivitas gateway.
app.get("/wa/preflight", async (c) => {
  const probe = c.req.query("probe") === "1" || c.req.query("probe") === "true";
  return c.json(await waPreflight(probe));
});

// ── Auth/session ──
app.post("/auth/login", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { email?: string; username?: string; identifier?: string; password?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const ident = body.identifier || body.username || body.email;
  if (!ident || !body.password) return c.json({ error: "username & password wajib" }, 400);
  const user = await verifyCredentials(ident, body.password);
  if (!user) return c.json({ error: "kredensial salah" }, 401);
  const token = signJwt({ sub: user.id, email: user.email, role: user.role, name: user.name, title: user.title });
  return c.json({ token, user });
});

app.get("/auth/me", async (c) => {
  const authz = c.req.header("authorization") ?? "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7) : "";
  const payload = token ? verifyJwt(token) : null;
  if (!payload) return c.json({ error: "unauthorized" }, 401);
  // Lampirkan izin efektif RBAC (grup + matriks per-fitur) — dipakai web utk
  // gate menu/aksi. Fallback ke role lama bila DB mati / belum ada keanggotaan.
  let superuser = false;
  let groups: { id: number; key: string; name: string }[] = [];
  let permissions: Record<string, unknown> = {};
  // rbac=true → matriks izin BENAR-BENAR terbaca dari DB, jadi `permissions`
  // kosong artinya "tanpa akses" (bukan "data izin tak tersedia"). Web butuh
  // pembeda ini: tanpa flag, user tanpa grup ikut kena fail-open hasPerms()
  // dan malah melihat seluruh menu (lihat apps/web/src/lib/perms.ts).
  let rbac = false;
  let am_id: string | null = null;
  let hod_key: string | null = null; // utk gate menu Raport & NPK Saya (HoD) di web
  let is_am = false;
  let is_hod = false;
  if (isDbEnabled() && payload.sub) {
    try {
      const eff = await effectivePermissions(String(payload.sub));
      superuser = eff.superuser; groups = eff.groups; permissions = eff.permissions; rbac = true;
    } catch { /* abaikan — pakai role lama */ }
    try {
      // Identitas karyawan (utk gate menu Raport & NPK Saya + scoping). scope.amOnly = AM
      // sejati; hod_key/cabangScope = HoD (lihat semua karyawan di menu List Raport).
      const scope = await resolveScope(String(payload.sub));
      am_id = scope.amId; hod_key = scope.hodKey ?? null;
      is_am = scope.amOnly; is_hod = !!scope.hodKey || !!(scope.cabangScope && scope.cabangScope.length);
    } catch { /* abaikan */ }
  }
  return c.json({
    user: {
      id: payload.sub, email: payload.email, role: payload.role,
      name: payload.name ?? null, title: payload.title ?? null,
      am_id, hod_key, is_am, is_hod,
      superuser, groups, permissions, rbac,
    },
  });
});

// ── HR Raport 360 (scorecard per karyawan) ──
// /raport/me = diri sendiri (identitas dari sesi via x-user-id, bukan param — cegah
// akses raport orang lain). /raport/list & /raport/:amId = admin/HoD.
app.get("/raport/me", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const scope = await resolveScope(c.req.header("x-user-id"));
  if (!scope.amId) return c.json({ linked: false, message: "Akun belum tertaut ke karyawan (am_id)." });
  const r = await getRaportDetail(scope.amId, c.req.query("period") || undefined);
  if (!r.found) return c.json({ error: "not found" }, 404);
  return c.json({ linked: true, ...r });
});

app.get("/raport/list", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const scope = await resolveScope(c.req.header("x-user-id"));
  if (scope.amOnly) return c.json({ error: "forbidden" }, 403); // AM murni tak boleh daftar semua
  return c.json(await getRaportList(c.req.query("period") || undefined));
});

app.get("/raport/:amId", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const amId = c.req.param("amId");
  const scope = await resolveScope(c.req.header("x-user-id"));
  if (scope.amOnly && scope.amId !== amId) return c.json({ error: "forbidden" }, 403);
  const r = await getRaportDetail(amId, c.req.query("period") || undefined);
  if (!r.found) return c.json({ error: "not found" }, 404);
  return c.json(r);
});

// Fase 3 — generate narasi AI raport (admin/superuser). Batch (test/manual) + per-orang.
app.post("/raport/narrative/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const scope = await resolveScope(c.req.header("x-user-id"));
  if (!scope.superuser) return c.json({ error: "forbidden" }, 403);
  return c.json(await runRaportNarrative({ period: c.req.query("period") || undefined }));
});
app.post("/raport/:amId/narrative", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const scope = await resolveScope(c.req.header("x-user-id"));
  if (!scope.superuser) return c.json({ error: "forbidden" }, 403);
  return c.json(await generateRaportNarrative(c.req.param("amId"), c.req.query("period") || undefined));
});

// Register ops: butuh x-service-token bila API_SERVICE_TOKEN di-set; atau saat
// belum ada user sama sekali (bootstrap admin pertama).
app.post("/auth/register", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const svc = process.env.API_SERVICE_TOKEN;
  const bootstrap = (await countUsers()) === 0;
  if (svc && c.req.header("x-service-token") !== svc && !bootstrap) {
    return c.json({ error: "forbidden" }, 403);
  }
  let body: { email?: string; password?: string; name?: string; role?: string; title?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.email || !body.password) return c.json({ error: "email & password wajib" }, 400);
  const user = await createUser(body.email, body.password, body.name, body.role ?? "user", body.title);
  return c.json({ user }, 201);
});

// Self change-password — verifikasi Bearer JWT (BUKAN service-token) untuk dapat id.
app.post("/auth/change-password", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const authz = c.req.header("authorization") ?? "";
  const claims = authz.startsWith("Bearer ") ? verifyJwt(authz.slice(7)) : null;
  if (!claims?.sub) return c.json({ error: "unauthorized" }, 401);
  let body: { current?: string; next?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON body" }, 400); }
  if (!body.current || !body.next || body.next.length < 6) return c.json({ error: "current & next (min 6) wajib" }, 400);
  const r = await changeOwnPassword(String(claims.sub), body.current, body.next);
  return c.json(r, r.ok ? 200 : 400);
});

// ── User Access (admin) — BFF tepercaya via service-token; role-guard di web ──
app.get("/admin/users", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json({ users: await listAppUsers() });
});

// Pesan WA berisi kredensial akses (dipakai create + reset password).
function accessWaMsg(email: string, pw: string): string {
  const url = (process.env.WEB_PUBLIC_URL || "").replace(/\/$/, "");
  return `🔐 *Akses WRG OS*\nEmail: ${email}\nPassword: ${pw}\n${url ? `Login: ${url}/login\n` : ""}Mohon ganti password setelah login.`;
}
// Ringkas hasil gateway → mode + delivered. stub/dry-run = tidak benar-benar
// terkirim (walau sendViaWaGateway balikan sent:true), jadi delivered hanya true
// pada mode live yang sukses. Dipakai UI utk status jujur.
function waSummary(g: WaSendResult): { mode: "stub" | "dry-run" | "live"; delivered: boolean; error?: string } {
  const mode = g.stub ? "stub" : g.dryRun ? "dry-run" : "live";
  return { mode, delivered: mode === "live" && g.sent, error: g.error };
}

app.post("/admin/users", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let b: { email?: string; password?: string; generate?: boolean; name?: string; role?: string; title?: string; wa_number?: string } = {};
  try { b = await c.req.json(); } catch { /* opsional */ }
  if (!b.email) return c.json({ error: "email wajib" }, 400);
  const pw = b.password || (b.generate !== false ? generatePassword() : "");
  if (!pw) return c.json({ error: "password atau generate wajib" }, 400);
  const user = await createUser(b.email, pw, b.name, b.role ?? "user", b.title);
  if (b.wa_number) await updateAppUser(user.id, { wa_number: b.wa_number });
  // Kirim password via WA bila nomor diisi (sebelumnya tak pernah dikirim).
  const wa = b.wa_number ? waSummary(await sendViaWaGateway(b.wa_number, accessWaMsg(b.email, pw))) : undefined;
  return c.json({ user, password: pw, wa }, 201); // password ditampilkan sekali ke admin
});

app.post("/admin/users/from-roster", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let b: { am_id?: string; email?: string; role?: string } = {};
  try { b = await c.req.json(); } catch { /* opsional */ }
  if (!b.am_id || !b.email) return c.json({ error: "am_id & email wajib" }, 400);
  const pw = generatePassword();
  const r = await createUserFromRoster(b.am_id, b.email, pw, b.role ?? "user");
  return r.ok ? c.json({ user: r.user, password: pw }, 201) : c.json({ error: r.error }, 400);
});

app.patch("/admin/users/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let b: { name?: string; role?: string; title?: string | null; active?: boolean; wa_number?: string | null; am_id?: string | null; hod_key?: string | null } = {};
  try { b = await c.req.json(); } catch { /* opsional */ }
  const u = await updateAppUser(c.req.param("id"), b);
  return u ? c.json({ user: u }) : c.json({ error: "user tak ditemukan" }, 404);
});

app.delete("/admin/users/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return (await deleteAppUser(c.req.param("id"))) ? c.json({ ok: true }) : c.json({ error: "user tak ditemukan" }, 404);
});

// AM → Cabang (menu Admin). List AM (roster master_user) + opsi cabang dari
// hod_territory (WatchPoint). cabang menentukan region kartu Sales Performance.
app.get("/admin/am-cabang", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const [users, territory] = await Promise.all([listUsers({ role: "AM" }), listTerritory()]);
  const cabangOptions = [...new Set(territory.map((t) => t.cabang))].sort((a, b) => a.localeCompare(b));
  return c.json({
    rows: users.map((u) => ({
      am_id: u.am_id, nama: u.nama, panggilan: u.panggilan, cabang: u.cabang, aktif: u.aktif,
      golongan: u.golongan,
      // Customer MINIMUM per golongan (SK Pasal 2.1) — konteks kelayakan naik
      // golongan. BUKAN penyebut aspek NPK Customer: itu memakai target program
      // per AM di menu Sales → Target (lihat catatan di lib/npk-golongan.ts).
      customer_minimum: TARGET_CUSTOMER_MINIMUM[u.golongan ?? "OSP"] ?? null,
    })),
    cabang_options: cabangOptions,
    golongan_options: GOLONGAN.map((g) => ({ key: g, label: GOLONGAN_LABEL[g], customer_minimum: TARGET_CUSTOMER_MINIMUM[g] })),
  });
});
// PUT menerima `cabang` dan/atau `golongan` — field yang TIDAK dikirim tidak
// disentuh (undefined ≠ null; null berarti "kosongkan").
app.put("/admin/am-cabang", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let b: { am_id?: string; cabang?: string | null; golongan?: string | null } = {};
  try { b = await c.req.json(); } catch { /* opsional */ }
  if (!b.am_id) return c.json({ error: "am_id wajib" }, 400);
  const amId = String(b.am_id);
  let updated = false;
  if (b.cabang !== undefined) {
    updated = (await updateUserCabang(amId, b.cabang ?? null)).updated || updated;
  }
  if (b.golongan !== undefined) {
    const g = b.golongan === null || b.golongan === "" ? null : String(b.golongan);
    if (g !== null && !isGolongan(g)) return c.json({ error: "golongan tidak valid" }, 400);
    updated = (await updateUserGolongan(amId, g)).updated || updated;
  }
  if (b.cabang === undefined && b.golongan === undefined) {
    return c.json({ error: "tak ada field yang diubah" }, 400);
  }
  return updated ? c.json({ updated }) : c.json({ error: "AM tak ditemukan" }, 404);
});

// Set/reset password. body {password?|generate, force?, send_wa?}. Return password (sekali) + status WA.
app.post("/admin/users/:id/password", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const id = c.req.param("id");
  let b: { password?: string; force?: boolean; send_wa?: boolean } = {};
  try { b = await c.req.json(); } catch { /* opsional */ }
  const pw = b.password || generatePassword();
  if (!(await setUserPassword(id, pw, b.force ?? false))) return c.json({ error: "user tak ditemukan" }, 404);
  let wa: ReturnType<typeof waSummary> | undefined;
  if (b.send_wa) {
    const u = await getAppUserById(id);
    if (u?.wa_number) wa = waSummary(await sendViaWaGateway(u.wa_number, accessWaMsg(u.email, pw)));
    else wa = { mode: "live", delivered: false, error: "nomor WA kosong" };
  }
  return c.json({ ok: true, password: pw, wa, wa_sent: wa?.delivered ?? false });
});

// ── Akses Grup (RBAC, admin) — role-guard di web BFF (requireAdmin) ──
app.get("/admin/access/features", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json({ features: await listFeatures() });
});

// Sync katalog fitur dari menu (upsert) — dipanggil web dgn daftar item menu.
app.post("/admin/access/features/sync", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let b: { features?: FeatureInput[] } = {};
  try { b = await c.req.json(); } catch { /* opsional */ }
  if (!Array.isArray(b.features)) return c.json({ error: "features (array) wajib" }, 400);
  return c.json(await syncFeatures(b.features));
});

app.get("/admin/access/groups", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json({ groups: await listGroups() });
});

app.get("/admin/access/groups/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const g = await getGroup(Number(c.req.param("id")));
  return g ? c.json({ group: g }) : c.json({ error: "grup tak ditemukan" }, 404);
});

app.post("/admin/access/groups", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let b: { name?: string; description?: string } = {};
  try { b = await c.req.json(); } catch { /* opsional */ }
  if (!b.name) return c.json({ error: "name wajib" }, 400);
  const r = await createGroup(b.name, b.description ?? null);
  return r.ok ? c.json({ id: r.id }, 201) : c.json({ error: r.error }, 409);
});

app.patch("/admin/access/groups/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let b: { name?: string; description?: string | null } = {};
  try { b = await c.req.json(); } catch { /* opsional */ }
  const ok = await updateGroup(Number(c.req.param("id")), b);
  return ok ? c.json({ ok: true }) : c.json({ error: "grup tak ditemukan" }, 404);
});

app.delete("/admin/access/groups/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const r = await deleteGroup(Number(c.req.param("id")));
  return r.ok ? c.json({ ok: true }) : c.json({ error: r.error }, 400);
});

app.put("/admin/access/groups/:id/permissions", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let b: { permissions?: PermRow[] } = {};
  try { b = await c.req.json(); } catch { /* opsional */ }
  if (!Array.isArray(b.permissions)) return c.json({ error: "permissions (array) wajib" }, 400);
  const ok = await setPermissions(Number(c.req.param("id")), b.permissions);
  return ok ? c.json({ ok: true }) : c.json({ error: "grup tak ditemukan" }, 404);
});

app.put("/admin/access/groups/:id/members", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let b: { userIds?: string[] } = {};
  try { b = await c.req.json(); } catch { /* opsional */ }
  if (!Array.isArray(b.userIds)) return c.json({ error: "userIds (array) wajib" }, 400);
  const ok = await setMembers(Number(c.req.param("id")), b.userIds);
  return ok ? c.json({ ok: true }) : c.json({ error: "grup tak ditemukan" }, 404);
});

app.post("/admin/access/groups/:id/copy-from/:srcId", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const r = await copyPermissions(Number(c.req.param("srcId")), Number(c.req.param("id")));
  return r.ok ? c.json({ ok: true }) : c.json({ error: r.error }, 400);
});

// Event ingestion (ADR-024). Body harus berupa EventEnvelope yang valid.
app.post("/events", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  if (!isEventEnvelope(body)) {
    return c.json(
      { error: "payload is not a valid EventEnvelope (ADR-024)" },
      422,
    );
  }

  const event: EventEnvelope = body;
  // Persist ke audit_log (Layer 2 Input) kalau DB tersambung; else echo saja.
  let auditId: string | null = null;
  if (isDbEnabled()) {
    try {
      auditId = await insertAuditEvent(event);
    } catch (e) {
      return c.json({ error: "gagal persist audit_log", detail: String(e) }, 500);
    }
  }
  return c.json(
    {
      accepted: true,
      event_id: event.event_id,
      type: event.type,
      correlation_id: event.correlation_id,
      audit_id: auditId,
      persisted: auditId !== null,
    },
    202,
  );
});

// Tier AI/data: forward ke services/ai (FastAPI). api = orkestrator domain yang
// meng-enrich data dari DB sebelum memanggil tier AI. Klien (aiBaseUrl/callAi)
// dipindah ke ./ai.js agar dipakai bersama repo/agents (A1 distillation cascade).

// Proxy generik ke services/ai untuk operasi AI/data passthrough.
async function forwardToAi(c: Context, aiPath: string): Promise<Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  try {
    const res = await fetch(`${aiBaseUrl()}${aiPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return c.json({ error: "ai service unreachable" }, 502);
  }
}

// Window periode rekap dari jam+tanggal (default mundur N jam), bisa di-override.
function deriveWindow(
  tanggal?: string,
  jam?: string,
  hours = 5,
  ps?: string,
  pe?: string,
): { periodStart: string; periodEnd: string } {
  if (ps && pe) return { periodStart: ps, periodEnd: pe };
  const t = jam && /^\d{2}:\d{2}$/.test(jam) ? jam : "00:00";
  const base = tanggal ? new Date(`${tanggal}T${t}:00Z`) : new Date();
  const end = Number.isNaN(base.getTime()) ? new Date() : base;
  const start = new Date(end.getTime() - hours * 3600 * 1000);
  return { periodStart: start.toISOString(), periodEnd: end.toISOString() };
}

app.post("/daily-summary", (c) => forwardToAi(c, "/daily-summary"));

app.post("/rekap", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  let r;
  try {
    r = await callAi("/rekap", body);
  } catch {
    return c.json({ error: "ai service unreachable" }, 502);
  }
  if (r.status >= 400 || !isDbEnabled()) return c.json(r.data, r.status === 200 ? 200 : (r.status as 200));
  try {
    const { periodStart, periodEnd } = deriveWindow(
      body.tanggal as string | undefined,
      body.jam as string | undefined,
      5,
      body.period_start as string | undefined,
      body.period_end as string | undefined,
    );
    const digestId = await insertRekap({
      group_jid: (body.group_jid as string) ?? "_all",
      group_name: (body.group_name as string) ?? "WRG (agregat semua grup aktif)",
      period_start: periodStart,
      period_end: periodEnd,
      raw_output: String(r.data.rekap ?? ""),
      model_used: r.data.model as string | undefined,
    });
    return c.json({ ...r.data, persisted: true, digest_id: digestId });
  } catch (e) {
    return c.json({ ...r.data, persisted: false, persist_error: String(e) });
  }
});

app.post("/resume", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  let r;
  try {
    r = await callAi("/resume", body);
  } catch {
    return c.json({ error: "ai service unreachable" }, 502);
  }
  if (r.status >= 400 || !isDbEnabled()) return c.json(r.data, r.status === 200 ? 200 : (r.status as 200));
  try {
    const digestId = await insertResume({
      period_date: (body.tanggal as string) ?? new Date().toISOString().slice(0, 10),
      period_type: (body.period_type as string) ?? "evening",
      raw_output: String(r.data.resume ?? ""),
      model_used: r.data.model as string | undefined,
    });
    return c.json({ ...r.data, persisted: true, digest_id: digestId });
  } catch (e) {
    return c.json({ ...r.data, persisted: false, persist_error: String(e) });
  }
});

// ── CRM parser domain (port legacy/crm wrg-plan / wrg-report) ──
// Pure parsing/normalisasi/klasifikasi. Persistensi ke PostgreSQL (INSERT
// sales_plan/activity_log) menyusul saat DB tersambung — endpoint ini balas
// struktur yang AKAN disimpan + (untuk report) hasil fuzzy-match ke plan.

app.post("/parse/plan", async (c) => {
  let body: { message?: string; now?: string; deadline?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (typeof body.message !== "string") {
    return c.json({ error: "body.message (string) wajib" }, 400);
  }
  return c.json(parsePlan(body.message, { now: body.now, deadline: body.deadline }));
});

app.post("/parse/report", async (c) => {
  let body: { message?: string; plans?: PlanCandidate[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (typeof body.message !== "string") {
    return c.json({ error: "body.message (string) wajib" }, 400);
  }
  const parsed = parseReport(body.message);
  const plans = body.plans ?? [];
  // Lampirkan fuzzy-match per item ke plan kandidat (sales_plan hari itu).
  const items = parsed.items.map((it) => ({
    ...it,
    match: matchCustomer(it.customer, plans),
  }));
  return c.json({ ...parsed, items });
});

// ── Domain action: parse + persist ke D1 (deal/spt_state_log) ──
// #PLAN → upsert deal pipeline; #REPORT → fuzzy-match deal + spt_state_log.
// Butuh DATABASE_URL + am_id. Tanpa DB → 503 (pakai /parse/* utk preview).

app.post("/plan", async (c) => {
  let body: { message?: string; am_id?: string; now?: string; deadline?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (typeof body.message !== "string") {
    return c.json({ error: "body.message (string) wajib" }, 400);
  }
  const parsed = parsePlan(body.message, { now: body.now, deadline: body.deadline });
  if (!isDbEnabled()) {
    return c.json({ ...parsed, persisted: false, note: "DATABASE_URL off — pakai /parse/plan utk preview" });
  }
  if (!body.am_id) return c.json({ error: "body.am_id wajib untuk persist" }, 400);
  if (parsed.customers.length === 0) return c.json({ ...parsed, persisted: false }, 400);
  try {
    const deals = await upsertDealsFromPlan(body.am_id, parsed.customers);
    return c.json({ ...parsed, persisted: true, deals }, 201);
  } catch (e) {
    return c.json({ error: "gagal persist deal", detail: String(e) }, 500);
  }
});

app.post("/report", async (c) => {
  let body: { message?: string; am_id?: string; to_stage?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (typeof body.message !== "string") {
    return c.json({ error: "body.message (string) wajib" }, 400);
  }
  const parsed = parseReport(body.message);
  if (!isDbEnabled()) {
    return c.json({ ...parsed, persisted: false, note: "DATABASE_URL off — pakai /parse/report utk preview" });
  }
  if (!body.am_id) return c.json({ error: "body.am_id wajib untuk persist" }, 400);
  const amId = body.am_id;
  const toStage = body.to_stage;
  try {
    const matched = await logReportToDeals(amId, parsed.items, toStage);
    // Match ambiguous → masuk HITL queue (gate D6), tidak auto-transisi.
    const items = [];
    for (const it of matched) {
      if (it.match.kind === "ambiguous") {
        const hitlId = await enqueueAmbiguous({
          amId,
          item: { customer: it.customer, hasil: it.hasil, next_action: it.next_action },
          candidates: it.match.candidates,
          toStage,
        });
        items.push({ ...it, hitl_id: hitlId });
      } else {
        items.push(it);
      }
    }
    return c.json({ mode: parsed.mode, tanggal: parsed.tanggal, errors: parsed.errors, persisted: true, items }, 201);
  } catch (e) {
    return c.json({ error: "gagal persist report", detail: String(e) }, 500);
  }
});

// ── Dashboard KPI read model ──
app.get("/stats", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const amId = c.req.query("am_id") || undefined;
  return c.json(await getDashboardStats(amId));
});

// ── Digest history (monitor rekap/resume tersimpan) ──
app.get("/digests", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const limit = Math.min(Number(c.req.query("limit") ?? 20) || 20, 100);
  return c.json(await getDigestHistory(limit));
});

// Infografis Digest History — metadata (monitor_digest) + metrik konten (recompute).
app.get("/digests/stats", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const days = Number(c.req.query("days") ?? 30) || 30;
  return c.json(await getDigestInsights(days));
});

// ── AR Aging (D2): feeder Accurate + read model ──
app.post("/ar/invoices", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { invoices?: InvoiceInput[]; asof?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!Array.isArray(body.invoices) || body.invoices.length === 0) {
    return c.json({ error: "body.invoices (array non-kosong) wajib" }, 400);
  }
  return c.json(await ingestInvoices(body.invoices, body.asof), 201);
});

// AR read model — ber-scope row-level (AM = AR atas namanya, HoD = cabang tim).
// Identitas dari header x-user-id yang diteruskan halaman/BFF web.
app.get("/ar/aging", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const scope = await resolveScope(c.req.header("x-user-id"));
  return c.json(await getAging(c.req.query("bucket") || undefined, scope));
});

// F30 — AR aging per customer (breakdown 5 bucket + prioritas tagih). Read-only.
app.get("/ar/aging/by-customer", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await arAgingByCustomer(await resolveScope(c.req.header("x-user-id"))));
});

// Detail satu invoice (header + line item) by nomor invoice. Read-only.
// Di luar scope → 404, bukan 403: jangan bocorkan bahwa nomornya ada.
app.get("/ar/invoice/:no", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const no = c.req.param("no");
  if (!no) return c.json({ error: "no invoice wajib" }, 400);
  const r = await invoiceDetail(no, await resolveScope(c.req.header("x-user-id")));
  return c.json(r, r.ok ? 200 : 404);
});

// Sync Accurate (puller, pengganti sync_accurate.sh). Read-only ke API Accurate
// → mirror accurate_* + refresh ar_aging. body: {days?, invoice_id?}.
app.post("/accurate/sync", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  if (!accurateConfigured()) return c.json({ error: "kredensial Accurate tak tersedia" }, 503);
  let body: { days?: number; invoice_id?: number } = {};
  try {
    body = await c.req.json();
  } catch {
    /* body opsional */
  }
  const r = await syncAccurateInvoices({ days: body.days, invoiceId: body.invoice_id });
  return c.json(r, r.ok ? 200 : 502);
});

app.get("/accurate/sync/state", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json({ configured: accurateConfigured() });
});

// Sinkron master vendor Accurate → accurate_vendor (menu Suppliers).
app.post("/accurate/sync/vendors", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  if (!accurateConfigured()) return c.json({ error: "kredensial Accurate tak tersedia" }, 503);
  const r = await syncVendors();
  return c.json(r, r.ok ? 200 : 502);
});

// Sinkron master customer Accurate → accurate_customer (backfill nama yg kosong).
app.post("/accurate/sync/customers", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  if (!accurateConfigured()) return c.json({ error: "kredensial Accurate tak tersedia" }, 503);
  const r = await syncCustomers();
  return c.json(r, r.ok ? 200 : 502);
});

// Sinkron full katalog item + stok Accurate → accurate_item (menu Inventory & Products).
app.post("/accurate/sync/items", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  if (!accurateConfigured()) return c.json({ error: "kredensial Accurate tak tersedia" }, 503);
  const r = await syncItems();
  return c.json(r, r.ok ? 200 : 502);
});

// Detail satu vendor (on-demand) utk rincian Suppliers.
app.get("/accurate/vendors/:id/detail", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  if (!accurateConfigured()) return c.json({ error: "kredensial Accurate tak tersedia" }, 503);
  const id = Number(c.req.param("id"));
  if (!id) return c.json({ error: "id invalid" }, 400);
  const r = await getVendorDetail(id);
  return c.json(r, r.ok ? 200 : 502);
});

// Sinkron sales-order terbaru Accurate → accurate_sales_order (menu Orders). ?pages=N (default 5).
app.post("/accurate/sync/orders", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  if (!accurateConfigured()) return c.json({ error: "kredensial Accurate tak tersedia" }, 503);
  const pages = Math.min(Math.max(Number(c.req.query("pages")) || 5, 1), 120);
  const r = await syncSalesOrders({ maxPages: pages });
  return c.json(r, r.ok ? 200 : 502);
});

// Baris produk satu sales-order (on-demand dari Accurate detail.do).
app.get("/accurate/sales-orders/:id/items", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  if (!accurateConfigured()) return c.json({ error: "kredensial Accurate tak tersedia" }, 503);
  const id = Number(c.req.param("id"));
  if (!id) return c.json({ error: "id invalid" }, 400);
  const r = await getSalesOrderItems(id);
  return c.json(r, r.ok ? 200 : 502);
});

// List sales-order (recent-first) utk menu Orders.
app.get("/accurate/sales-orders", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 500, 1), 10000);
  const rows = await listSalesOrders(limit);
  return c.json({ entity: "sales-orders", count: rows.length, rows });
});

// Sinkron delivery-order terbaru Accurate → accurate_delivery_order (menu Shipments). ?pages=N (default 5).
app.post("/accurate/sync/shipments", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  if (!accurateConfigured()) return c.json({ error: "kredensial Accurate tak tersedia" }, 503);
  const pages = Math.min(Math.max(Number(c.req.query("pages")) || 5, 1), 120);
  const r = await syncDeliveryOrders({ maxPages: pages });
  return c.json(r, r.ok ? 200 : 502);
});

// Backfill baris item SO/DO ke mirror (dasar fill rate F76). Berbatas per
// pemanggilan — `pending` di balikan = sisa dokumen sebenarnya di dalam jendela
// `days` (count penuh, tidak dibatasi `limit`), panggil ulang sampai 0.
// ?kind=so|do (default keduanya), ?limit= dokumen/panggilan, ?days= jendela tanggal.
app.post("/accurate/sync/doc-items", async (c) => {
  // Validasi bentuk permintaan DULU: parameter salah harus 400 apa pun status
  // kredensial, kalau tidak pemanggil dapat 503 yang menyesatkan.
  const kind = (c.req.query("kind") ?? "").trim().toLowerCase();
  if (kind && kind !== "so" && kind !== "do") return c.json({ error: "kind harus so|do" }, 400);
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  if (!accurateConfigured()) return c.json({ error: "kredensial Accurate tak tersedia" }, 503);
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 150, 1), 1000);
  const sinceDays = Math.min(Math.max(Number(c.req.query("days")) || 120, 1), 1095);
  const out: Record<string, unknown> = {};
  if (kind !== "do") out.salesOrders = await syncSalesOrderItems({ limit, sinceDays });
  if (kind !== "so") out.deliveryOrders = await syncDeliveryOrderItems({ limit, sinceDays });
  const ok = Object.values(out).every((v) => (v as { ok: boolean }).ok);
  return c.json(out, ok ? 200 : 502);
});

// Baris produk satu surat jalan (on-demand dari Accurate detail.do).
app.get("/accurate/shipments/:id/items", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  if (!accurateConfigured()) return c.json({ error: "kredensial Accurate tak tersedia" }, 503);
  const id = Number(c.req.param("id"));
  if (!id) return c.json({ error: "id invalid" }, 400);
  const r = await getDeliveryOrderItems(id);
  return c.json(r, r.ok ? 200 : 502);
});

// List delivery-order (recent-first) utk menu Shipments.
app.get("/accurate/shipments", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 500, 1), 10000);
  const rows = await listDeliveryOrders(limit);
  return c.json({ entity: "shipments", count: rows.length, rows });
});

// AR (piutang) per customer / cabang / sales — dari accurate_invoice OPEN.
app.get("/ar/sales", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const scope = await resolveScope(c.req.header("x-user-id"));
  return c.json(await reportSalesAr(c.req.query("from") || undefined, c.req.query("to") || undefined, scope));
});

// ── WRG Monitor: direktori member WA (port wrg-monitor) ──
app.get("/monitor/members", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const members = await listMembers();
  return c.json({ count: members.length, members });
});

app.post("/monitor/members", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { members?: MonitorMemberInput[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!Array.isArray(body.members) || body.members.length === 0) {
    return c.json({ error: "body.members (array non-kosong) wajib" }, 400);
  }
  return c.json({ upserted: await upsertMembers(body.members) }, 201);
});

app.get("/monitor/rekap", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await listDigest("rekap", c.req.query("date") || undefined));
});

app.get("/monitor/resume", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await listDigest("resume", c.req.query("date") || undefined));
});

// Infografis rekap/resume — agregasi aktivitas WA (KPI + chart) untuk satu tanggal.
app.get("/monitor/stats", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const date = c.req.query("date");
  if (!date) return c.json({ error: "query date (YYYY-MM-DD) wajib" }, 400);
  return c.json(await digestStats(date));
});

app.post("/monitor/digests", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { digests?: DigestInput[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!Array.isArray(body.digests) || body.digests.length === 0) {
    return c.json({ error: "body.digests (array non-kosong) wajib" }, 400);
  }
  return c.json({ upserted: await upsertDigests(body.digests) }, 201);
});

app.get("/monitor/pola", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await listPola(c.req.query("jid") || undefined));
});

// Generate rekap/resume via services/ai dari wa_message (generate-only — TIDAK
// kirim WA, tak mengganggu cron wrg-monitor lama). Trigger manual dari UI.
const wibJam = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(11, 16);
app.post("/monitor/rekap/generate", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { date?: string; jam?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    /* body opsional */
  }
  const date = body.date || defaultRange().today;
  const r = await generateRekap(date, body.jam || wibJam());
  return c.json(r, r.stored ? 200 : 502);
});
app.post("/monitor/resume/generate", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { date?: string; jam?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    /* body opsional */
  }
  const date = body.date || defaultRange().today;
  const r = await generateResume(date, body.jam || wibJam());
  return c.json(r, r.stored ? 200 : 502);
});

// Notif item TUA (port notif_tua.sh) — kirim item OUTSTANDING TUA dari resume
// terbaru ke NOTIF_TUA_TARGET. body: {dry_run?, target?}. dry_run → payload saja.
app.post("/notif/tua", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { dry_run?: boolean; target?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    /* body opsional */
  }
  const r = await runNotifTua({ dryRun: body.dry_run, target: body.target });
  return c.json(r);
});

// Daily Summary (port wrg-daily.sh daily_summary) — ringkasan harian AI ke grup.
// body: {dry_run?, target?}. dry_run → generate + simpan, TANPA kirim WA.
app.post("/daily-summary/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { dry_run?: boolean; target?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    /* body opsional */
  }
  const r = await runDailySummary({ dryRun: body.dry_run, target: body.target });
  return c.json(r);
});

// Weekly Report (port cron_weekly_report.sh) — KPI minggu kerja lalu ke grup.
// body: {dry_run?, target?, from?, to?}. dry_run → susun + simpan, TANPA kirim.
app.post("/weekly-report/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { dry_run?: boolean; target?: string; from?: string; to?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    /* body opsional */
  }
  const r = await runWeeklyReport({ dryRun: body.dry_run, target: body.target, from: body.from, to: body.to });
  return c.json(r);
});

// detect_leave (port detect_leave.sh) — scan grup HRD: deteksi izin/cuti + approval.
// body: {dry_run?}. dry_run → scan + LLM, TANPA insert pending/kirim/approve.
app.post("/detect-leave/scan", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { dry_run?: boolean } = {};
  try {
    body = await c.req.json();
  } catch {
    /* body opsional */
  }
  const r = await runDetectLeaveScan({ dryRun: body.dry_run });
  return c.json(r);
});

// extract_competitor (port extract_competitor.sh) — LLM ekstrak sebutan kompetitor
// dari activity_log → competitor_intel. body: {dry_run?, limit?, backfill_days?}.
app.post("/extract-competitor/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { dry_run?: boolean; limit?: number; backfill_days?: number } = {};
  try {
    body = await c.req.json();
  } catch {
    /* body opsional */
  }
  const r = await runExtractCompetitor({ dryRun: body.dry_run, limit: body.limit, backfillDays: body.backfill_days });
  return c.json(r);
});

// briefing_weekend (port briefing_weekend.sh) — briefing direktur dari resume 7 hari.
// body: {dry_run?}. GENERATE-ONLY (simpan monitor_digest kind='briefing', tanpa WA).
app.post("/weekend-briefing/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { dry_run?: boolean } = {};
  try {
    body = await c.req.json();
  } catch {
    /* body opsional */
  }
  const r = await runWeekendBriefing({ dryRun: body.dry_run });
  return c.json(r);
});

// pola_komunikasi (port pola_komunikasi.sh) — profil pola per-grup → monitor_pola.
// body: {dry_run?, window_days?, min_messages?}. GENERATE-ONLY (tanpa WA).
app.post("/pola/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { dry_run?: boolean; window_days?: number; min_messages?: number } = {};
  try {
    body = await c.req.json();
  } catch {
    /* body opsional */
  }
  const r = await runPolaKomunikasi({ dryRun: body.dry_run, windowDays: body.window_days, minMessages: body.min_messages });
  return c.json(r);
});

// list_members (port list_members.sh, pragmatis) — sync roster master_user → monitor_member.
// body: {dry_run?}. Tanpa WA/LLM.
app.post("/members/sync", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { dry_run?: boolean } = {};
  try {
    body = await c.req.json();
  } catch {
    /* body opsional */
  }
  const r = await runRefreshMembers({ dryRun: body.dry_run });
  return c.json(r);
});

// notif_quota (port notif_quota.sh) — probe OpenRouter, alert owner bila key/limit bermasalah.
// body: {dry_run?, force?}.
app.post("/notif/quota", async (c) => {
  let body: { dry_run?: boolean; force?: boolean } = {};
  try {
    body = await c.req.json();
  } catch {
    /* body opsional */
  }
  const r = await runNotifQuota({ dryRun: body.dry_run, force: body.force });
  return c.json(r);
});

app.post("/monitor/pola", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { pola?: PolaInput[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!Array.isArray(body.pola) || body.pola.length === 0) {
    return c.json({ error: "body.pola (array non-kosong) wajib" }, 400);
  }
  return c.json({ upserted: await upsertPola(body.pola) }, 201);
});

// Webhook Accurate → ar_aging_mv. Menerima invoice Accurate (single | array |
// {d} | {data} | {invoices}). Upsert idempoten by customer_id+invoice_no.
// Jika ACCURATE_WEBHOOK_SECRET di-set, header x-accurate-secret wajib cocok.
app.post("/webhooks/accurate", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const secret = process.env.ACCURATE_WEBHOOK_SECRET;
  if (secret && c.req.header("x-accurate-secret") !== secret) {
    return c.json({ error: "unauthorized" }, 401);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  // Normalisasi ke array objek invoice Accurate.
  let records: AccurateInvoice[];
  if (Array.isArray(body)) records = body as AccurateInvoice[];
  else if (body && typeof body === "object") {
    const b = body as { d?: unknown; data?: unknown; invoices?: unknown };
    if (Array.isArray(b.invoices)) records = b.invoices as AccurateInvoice[];
    else if (Array.isArray(b.data)) records = b.data as AccurateInvoice[];
    else if (b.data && typeof b.data === "object") records = [b.data as AccurateInvoice];
    else if (b.d && typeof b.d === "object") records = [b.d as AccurateInvoice];
    else records = [body as AccurateInvoice]; // single invoice object
  } else {
    return c.json({ error: "payload tidak dikenali" }, 400);
  }
  if (records.length === 0) return c.json({ ingested: 0, skipped: 0 });
  const asof = c.req.query("asof") || undefined;
  return c.json(await ingestAccurateWebhook(records, asof), 201);
});

// A2 AR Aging Watch agent — analisis ar_aging_mv + log ke audit_log (D6).
app.post("/agents/a2/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await runArWatch(), 201);
});

// A3 Sari Collection Drafter — draft pesan penagihan invoice overdue (D2).
// Body opsional: { draft_type: whatsapp|email|formal_letter, limit }.
app.post("/agents/a3/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { draft_type?: string; limit?: number } = {};
  try {
    body = await c.req.json();
  } catch {
    // body opsional — default: whatsapp, limit 10.
  }
  const r = await runCollectionDrafter({ draftType: body.draft_type, limit: body.limit });
  return c.json(r, r.drafted ? 201 : 200);
});

// A4 Pipeline Authenticity — audit keaslian pipeline, eskalasi kritis ke HITL (D1).
app.post("/agents/a4/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await runPipelineAuthenticity(), 201);
});

// A5 Anomaly Detection — outlier numerik lintas-domain, eskalasi kritis ke HITL.
app.post("/agents/a5/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await runAnomalyDetection(), 201);
});

// A6 Sales Doc Drafter — draft dokumen penjualan (D1). Body opsional:
// { deal_id, doc_type: sph|offering_letter|presentation|mou, limit }.
app.post("/agents/a6/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { deal_id?: string; doc_type?: string; limit?: number } = {};
  try {
    body = await c.req.json();
  } catch {
    // body opsional — default: batch, limit 5.
  }
  const r = await runSalesDocDrafter({
    dealId: body.deal_id,
    docType: body.doc_type,
    limit: body.limit,
  });
  return c.json(r, r.drafted ? 201 : 200);
});

// Read model dokumen penjualan (status: draft|approved|sent|canceled).
app.get("/sales/docs", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const docs = await listSalesDocs(c.req.query("status") || undefined);
  return c.json({ count: docs.length, docs });
});

// Siklus kirim A6 (aksi manusia, Layer 5): approve → send → (atau cancel).
app.post("/sales/docs/:id/approve", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { approver_id?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    /* body opsional */
  }
  const r = await approveSalesDoc(c.req.param("id"), body.approver_id);
  return c.json(r, r.ok ? 200 : 400);
});

app.post("/sales/docs/:id/send", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { to?: string; approver_id?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.to) return c.json({ error: "body.to (tujuan) wajib" }, 400);
  const r = await sendSalesDoc(c.req.param("id"), body.to, body.approver_id);
  return c.json(r, r.ok ? 200 : 400);
});

app.post("/sales/docs/:id/cancel", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { approver_id?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    /* body opsional */
  }
  const r = await cancelSalesDoc(c.req.param("id"), body.approver_id);
  return c.json(r, r.ok ? 200 : 400);
});

// F11 Approval Engine — base/generic (migrasi 106). Body:
// { title, description?, nominal?, requestedBy, requestedByWa? }.
app.post("/approval-requests", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: Parameters<typeof createApprovalRequest>[0] | undefined;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body?.title || !body?.requestedBy) {
    return c.json({ error: "title & requestedBy wajib" }, 400);
  }
  const r = await createApprovalRequest(body);
  return c.json(r, r.ok ? 201 : 400);
});

app.get("/approval-requests", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const rows = await listApprovalRequests(c.req.query("status") || undefined);
  return c.json({ count: rows.length, requests: rows });
});

app.get("/approval-requests/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const r = await getApprovalRequest(c.req.param("id"));
  if (!r) return c.json({ error: "request tidak ditemukan" }, 404);
  return c.json(r);
});

// Retry manual kirim notifikasi tahap current — dipakai kalau step pertama
// gagal krn kontak belum dikonfigurasi, lalu config-nya baru diisi belakangan.
app.post("/approval-requests/:id/notify", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const r = await notifyCurrentStep(c.req.param("id"));
  return c.json(r, r.ok ? 200 : 400);
});

app.get("/approval-requests/config/chain", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json({ rows: await listChainConfig() });
});

app.patch("/approval-requests/config/chain/:urutan", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { hodKey?: string | null; waNumberOverride?: string | null } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const urutan = Number(c.req.param("urutan"));
  if (!urutan) return c.json({ error: "urutan tidak valid" }, 400);
  const r = await updateChainConfig(urutan, body);
  return c.json(r, r.ok ? 200 : 400);
});

// Serve lampiran PDF/PNG approval (F11). Path-safe (getAttachmentFile join
// di dalam APPROVAL_UPLOAD_ROOT), request_id+attachment_id harus cocok.
app.get("/approval-requests/:id/attachments/:attachmentId", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const attachmentId = Number(c.req.param("attachmentId"));
  if (!attachmentId) return c.json({ error: "attachmentId tidak valid" }, 400);
  const file = await getAttachmentFile(c.req.param("id"), attachmentId);
  if (!file) return c.json({ error: "lampiran tidak ditemukan" }, 404);
  return c.body(new Uint8Array(file.buf), 200, {
    "content-type": file.mimeType,
    "content-disposition": `inline; filename="${file.filename.replace(/"/g, "")}"`,
    "cache-control": "private, max-age=86400",
  });
});

// F19 Forecast Submission Engine — scan gudang (F37 stok + F38 ED) → usulan.
// Manual trigger (tombol "Generate Usulan"), bukan cron di versi ini.
app.post("/forecast/generate", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await generateSuggestions());
});

app.get("/forecast/suggestions", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const rows = await listSuggestions(c.req.query("status") || undefined);
  return c.json({ count: rows.length, suggestions: rows });
});

app.patch("/forecast/suggestions/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { finalQty?: number | null; notes?: string | null } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const r = await updateSuggestion(c.req.param("id"), body);
  return c.json(r, r.ok ? 200 : 400);
});

app.post("/forecast/suggestions/:id/dismiss", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { reviewedBy?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    /* opsional */
  }
  const r = await dismissSuggestion(c.req.param("id"), body.reviewedBy);
  return c.json(r, r.ok ? 200 : 400);
});

app.post("/forecast/suggestions/:id/submit", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { submittedBy?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.submittedBy) return c.json({ error: "submittedBy wajib" }, 400);
  const r = await submitSuggestion(c.req.param("id"), body.submittedBy);
  return c.json(r, r.ok ? 200 : 400);
});

app.get("/forecast/buffer-config", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json({ rows: await listBufferConfig() });
});

app.post("/forecast/buffer-config", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { itemId?: number; warehouseKode?: string; bufferQty?: number; updatedBy?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.itemId || !body.warehouseKode || body.bufferQty == null) {
    return c.json({ error: "itemId, warehouseKode, bufferQty wajib" }, 400);
  }
  const r = await upsertBufferConfig({
    itemId: body.itemId,
    warehouseKode: body.warehouseKode,
    bufferQty: body.bufferQty,
    updatedBy: body.updatedBy ?? null,
  });
  return c.json(r, r.ok ? 200 : 400);
});

// A7 Product Intelligence — agregasi intelijen produk dari pipeline (D1).
app.post("/agents/a7/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await runProductIntelligence(), 201);
});

// Read model intelijen produk (live compute, tanpa audit) untuk UI.
app.get("/products/intelligence", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const products = await getProductIntelligence();
  return c.json({ count: products.length, products });
});

// A8 Sentiment & Entity Extraction — anotasi wa_message (D1b). Body opsional:
// { window_hours, group_jid, limit }.
app.post("/agents/a8/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { window_hours?: number; group_jid?: string; limit?: number } = {};
  try {
    body = await c.req.json();
  } catch {
    // body opsional
  }
  const r = await runSentimentExtraction({
    windowHours: body.window_hours,
    groupJid: body.group_jid,
    limit: body.limit,
  });
  return c.json(r, r.annotated ? 201 : 200);
});

// Read model anotasi (filter sentiment: positive|neutral|negative).
app.get("/messages/annotations", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const annotations = await listAnnotations(c.req.query("sentiment") || undefined);
  return c.json({ count: annotations.length, annotations });
});

// A9 Spider Network Analyst — graf relasi dari anotasi (D1b).
app.post("/agents/a9/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { window_days?: number } = {};
  try {
    body = await c.req.json();
  } catch {
    // body opsional
  }
  return c.json(await runSpiderNetwork({ windowDays: body.window_days }), 201);
});

// Read model graf jaringan (live compute, tanpa audit) untuk visualisasi UI.
app.get("/network/graph", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const days = Number(c.req.query("window_days")) || 30;
  const graph = computeNetwork(await getNetworkInput(days));
  return c.json(graph);
});

// A10 Executive Synthesis — briefing eksekutif lintas-domain (D6).
app.post("/agents/a10/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { period_label?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    // body opsional
  }
  return c.json(await runExecutiveSynthesis({ periodLabel: body.period_label }), 201);
});

// Read model briefing eksekutif.
app.get("/briefings", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const briefings = await listBriefings();
  return c.json({ count: briefings.length, briefings });
});

// A11 Coaching Outcome Synthesis — coaching per AM (D1). Body opsional: { period }.
app.post("/agents/a11/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { period?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    // body opsional
  }
  const r = await runCoachingSynthesis({ period: body.period });
  return c.json(r, r.synthesized ? 201 : 200);
});

// Read model catatan coaching (filter am_id).
app.get("/coaching/notes", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const notes = await listCoachingNotes(c.req.query("am_id") || undefined);
  return c.json({ count: notes.length, notes });
});

// A12 People Analytics — rollup SDM tingkat-organisasi dari coaching_note (D6).
app.post("/agents/a12/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await runPeopleAnalytics(), 201);
});

// Read model people analytics (live compute, tanpa audit) untuk UI.
app.get("/people/analytics", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(computePeopleAnalytics(await getLatestCoachingNotes()));
});

// ── Visit report AM (geotag + foto-URL; port legacy visit_geo/report_photo) ──
app.post("/visits", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: {
    am_id?: string;
    deal_id?: string;
    customer_name?: string;
    photo_url?: string;
    lat?: number;
    lon?: number;
    visit_timestamp?: string;
    visit_date?: string;
    note?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.am_id) return c.json({ error: "am_id wajib" }, 400);
  const r = await createVisit({
    am_id: body.am_id,
    deal_id: body.deal_id,
    customer_name: body.customer_name,
    photo_url: body.photo_url,
    lat: body.lat,
    lon: body.lon,
    visit_timestamp: body.visit_timestamp,
    visit_date: body.visit_date,
    note: body.note,
  });
  return c.json(r, 201);
});

// Read model visit (filter geo_status: ok|out_of_bounds|no_geo|date_mismatch).
// Ber-scope row-level: AM = kunjungannya sendiri, HoD = cabang timnya.
app.get("/visits", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const scope = await resolveScope(c.req.header("x-user-id"));
  const visits = await listVisits(c.req.query("status") || undefined, scope);
  return c.json({ count: visits.length, visits });
});

// Brief kepatuhan geotag (per-status + flagged).
app.get("/visits/summary", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await visitSummary(await resolveScope(c.req.header("x-user-id"))));
});

// KPI F16 CRM Fase 1: timeliness input ≤48 jam + capaian target kunjungan
// mingguan per AM. ?week=-1 → minggu lalu (dipakai rekap Senin).
app.get("/visits/kpi", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const raw = Number(c.req.query("week"));
  // Clamp: hanya minggu ini & ke belakang, biar tak diminta hitung minggu absurd.
  const week = Number.isFinite(raw) ? Math.min(0, Math.max(-52, Math.trunc(raw))) : 0;
  return c.json(await visitKpi(await resolveScope(c.req.header("x-user-id")), week));
});

// Detail 1 visit (didaftarkan SETELAH /visits/summary & /visits/kpi biar literal menang).
// Di luar scope → 404 (sama seperti tak ada), jangan bocorkan keberadaannya.
app.get("/visits/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const v = await getVisit(c.req.param("id"), await resolveScope(c.req.header("x-user-id")));
  return v ? c.json(v) : c.json({ error: "visit tak ditemukan" }, 404);
});

// Serve file media (foto kunjungan) dari capture openclaw — HANYA di bawah
// MEDIA_ROOT (default ~/.openclaw/media), path-validated anti traversal.
const MEDIA_ROOT = resolve(process.env.MEDIA_ROOT ?? `${homedir()}/.openclaw/media`);
const MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  gif: "image/gif", pdf: "application/pdf",
};
app.get("/media", async (c) => {
  const p = c.req.query("p");
  if (!p) return c.json({ error: "param p wajib" }, 400);
  const abs = resolve(p);
  if (abs !== MEDIA_ROOT && !abs.startsWith(MEDIA_ROOT + "/")) {
    return c.json({ error: "path di luar MEDIA_ROOT" }, 403);
  }
  try {
    const buf = await readFile(abs);
    const ext = abs.split(".").pop()?.toLowerCase() ?? "";
    return c.body(buf, 200, {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "cache-control": "private, max-age=86400",
    });
  } catch {
    return c.json({ error: "file tak ditemukan" }, 404);
  }
});

// ── Daily TODO/plan per AM (port legacy sales_todo) ──
app.post("/todos", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { am_id?: string; am_name?: string; tanggal?: string; items?: string[]; raw_body?: string; is_late_plan?: boolean };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.am_id || !body.tanggal || !Array.isArray(body.items)) {
    return c.json({ error: "am_id, tanggal (YYYY-MM-DD), items[] wajib" }, 400);
  }
  const r = await upsertDailyTodo({
    am_id: body.am_id,
    am_name: body.am_name,
    tanggal: body.tanggal,
    items: body.items,
    raw_body: body.raw_body,
    is_late_plan: body.is_late_plan,
  });
  return c.json(r, 201);
});

app.get("/todos", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const todos = await listTodos(c.req.query("am_id") || undefined, c.req.query("date") || undefined);
  return c.json({ count: todos.length, todos });
});

// Tandai plan harian sudah di-#REPORT (am_id + tanggal).
app.post("/todos/report", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { am_id?: string; tanggal?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.am_id || !body.tanggal) return c.json({ error: "am_id + tanggal wajib" }, 400);
  const r = await markTodoReported(body.am_id, body.tanggal);
  return c.json(r, r.ok ? 200 : 404);
});

// ── Master data CRM: user/AM roster + territory (port legacy master_*) ──
app.post("/master/users", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: {
    am_id?: string; nama?: string; panggilan?: string; wa_number?: string;
    role?: string; posisi?: string; cabang?: string; area?: string;
    aktif?: boolean; wajib_plan_report?: boolean;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.am_id || !body.nama) return c.json({ error: "am_id + nama wajib" }, 400);
  return c.json(await upsertUser({ am_id: body.am_id, nama: body.nama, panggilan: body.panggilan, wa_number: body.wa_number, role: body.role, posisi: body.posisi, cabang: body.cabang, area: body.area, aktif: body.aktif, wajib_plan_report: body.wajib_plan_report }), 201);
});

app.get("/master/users", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const aktifQ = c.req.query("aktif");
  const users = await listUsers({
    role: c.req.query("role") || undefined,
    aktif: aktifQ === undefined ? undefined : aktifQ === "true",
  });
  return c.json({ count: users.length, users });
});

app.post("/master/territories", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { am_panggilan?: string; hod_panggilan?: string; cabang?: string; kota?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.am_panggilan || !body.hod_panggilan || !body.cabang || !body.kota) {
    return c.json({ error: "am_panggilan, hod_panggilan, cabang, kota wajib" }, 400);
  }
  return c.json(await upsertTerritory({ am_panggilan: body.am_panggilan, hod_panggilan: body.hod_panggilan, cabang: body.cabang, kota: body.kota }), 201);
});

app.get("/master/territories", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const territories = await listTerritories();
  return c.json({ count: territories.length, territories });
});

// ── Leave/cuti + holiday (port legacy user_leave + master_holiday) ──
app.post("/holidays", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { tanggal?: string; keterangan?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.tanggal || !body.keterangan) return c.json({ error: "tanggal + keterangan wajib" }, 400);
  return c.json(await upsertHoliday(body.tanggal, body.keterangan), 201);
});

app.get("/holidays", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const holidays = await listHolidays();
  return c.json({ count: holidays.length, holidays });
});

app.delete("/holidays/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const r = await deleteHoliday(c.req.param("id"));
  return c.json(r, r.deleted ? 200 : 404);
});

app.post("/leave", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { am_id?: string; start_date?: string; end_date?: string; jenis?: string; keterangan?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.am_id || !body.start_date || !body.end_date || !body.jenis) {
    return c.json({ error: "am_id, start_date, end_date, jenis(sakit|cuti|ijin) wajib" }, 400);
  }
  if (!["sakit", "cuti", "ijin"].includes(body.jenis)) {
    return c.json({ error: "jenis harus sakit|cuti|ijin" }, 400);
  }
  return c.json(
    await createLeave({
      am_id: body.am_id,
      start_date: body.start_date,
      end_date: body.end_date,
      jenis: body.jenis as "sakit" | "cuti" | "ijin",
      keterangan: body.keterangan,
    }),
    201,
  );
});

app.get("/leave", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const leave = await listLeave(c.req.query("am_id") || undefined);
  return c.json({ count: leave.length, leave });
});

// Pending leave (detect-leave HRD) yg belum diputus — buat dashboard.
app.get("/leave/pending", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const pending = await listPendingLeave();
  return c.json({ count: pending.length, pending });
});

// Approve/reject pending dari dashboard. body: {approve: boolean, decided_by?}.
app.post("/leave/pending/:id/decide", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { approve?: boolean; decided_by?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    /* body opsional */
  }
  const r = await decidePendingLeave(Number(c.req.param("id")), body.approve === true, body.decided_by);
  return c.json(r, r.ok ? 200 : 404);
});

app.patch("/leave/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { start_date?: string; end_date?: string; jenis?: string; keterangan?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (body.jenis && !["sakit", "cuti", "ijin"].includes(body.jenis)) {
    return c.json({ error: "jenis harus sakit|cuti|ijin" }, 400);
  }
  const r = await updateLeave(c.req.param("id"), {
    start_date: body.start_date,
    end_date: body.end_date,
    jenis: body.jenis as "sakit" | "cuti" | "ijin" | undefined,
    keterangan: body.keterangan,
  });
  return c.json(r, r.updated ? 200 : 404);
});

app.delete("/leave/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const r = await deleteLeave(c.req.param("id"));
  return c.json(r, r.deleted ? 200 : 404);
});

// Cek apakah AM sedang cuti/libur pada tanggal tertentu (untuk exempt reminder).
app.get("/leave/check", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const amId = c.req.query("am_id");
  const date = c.req.query("date");
  if (!amId || !date) return c.json({ error: "am_id + date wajib" }, 400);
  return c.json(await isOnLeave(amId, date));
});

// Auto-deteksi cuti dari teks bebas (keyword + tanggal).
app.post("/leave/detect", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { am_id?: string; text?: string; date?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.am_id || !body.text) return c.json({ error: "am_id + text wajib" }, 400);
  const r = await detectLeave(body.am_id, body.text, body.date);
  return c.json(r, r.detected ? 201 : 200);
});

// ── Competitor intelligence (port legacy competitor_intel) ──
app.post("/competitor", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: {
    am_id?: string; customer_name?: string; tanggal?: string; vendor?: string;
    produk?: string; produk_kategori?: string; harga_text?: string; harga_numeric?: number; konteks?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.tanggal || !body.vendor) return c.json({ error: "tanggal + vendor wajib" }, 400);
  return c.json(
    await recordCompetitor({
      am_id: body.am_id, customer_name: body.customer_name, tanggal: body.tanggal,
      vendor: body.vendor, produk: body.produk, produk_kategori: body.produk_kategori,
      harga_text: body.harga_text, harga_numeric: body.harga_numeric, konteks: body.konteks,
    }),
    201,
  );
});

app.get("/competitor", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const items = await listCompetitor(c.req.query("vendor") || undefined);
  return c.json({ count: items.length, items });
});

app.get("/competitor/summary", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const summary = await competitorSummary();
  return c.json({ count: summary.length, summary });
});

// ── Plan & Report dashboard (replikasi WRG-CRM Adminator) ──
app.get("/report/range-default", (c) => c.json(defaultRange()));

app.get("/report/summary", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const { from, to } = parseRange(c.req.query("from"), c.req.query("to"));
  return c.json(await reportSummary(from, to));
});

app.get("/report/per-orang", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const { from, to } = parseRange(c.req.query("from"), c.req.query("to"));
  const rows = await reportPerOrang(from, to);
  return c.json({ from, to, count: rows.length, rows });
});

// F64 — compliance rate per AM (on-time/telat/miss atas hari-kerja diharapkan).
app.get("/report/compliance", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const { from, to } = parseRange(c.req.query("from"), c.req.query("to"));
  return c.json({ from, to, ...(await reportCompliance(from, to)) });
});

app.get("/report/per-divisi", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const { from, to } = parseRange(c.req.query("from"), c.req.query("to"));
  return c.json({ from, to, rows: await reportPerDivisi(from, to) });
});

app.get("/report/per-cabang", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const { from, to } = parseRange(c.req.query("from"), c.req.query("to"));
  return c.json({ from, to, rows: await reportPerCabang(from, to) });
});

app.get("/report/per-hod", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const { from, to } = parseRange(c.req.query("from"), c.req.query("to"));
  return c.json({ from, to, rows: await reportPerHod(from, to) });
});

app.get("/report/daily-trend", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const { from, to } = parseRange(c.req.query("from"), c.req.query("to"));
  return c.json({ from, to, days: await reportDailyTrend(from, to) });
});

app.get("/report/drilldown", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const amId = c.req.query("am_id");
  if (!amId) return c.json({ error: "am_id wajib" }, 400);
  const { from, to } = parseRange(c.req.query("from"), c.req.query("to"));
  return c.json({ from, to, detail: await reportDrilldown(amId, from, to) });
});

// Detail plan kunjungan SEMUA AM (buat export Excel detail).
app.get("/report/detail", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const { from, to } = parseRange(c.req.query("from"), c.req.query("to"));
  return c.json({ from, to, detail: await reportDetailAll(from, to) });
});

// Sales Calendar: agregat plan/report per (tanggal, AM) + libur + katalog AM
// untuk filter. from/to = rentang grid kalender (mis. awal–akhir 6 minggu).
// Ber-scope row-level: AM = kalendernya sendiri, HoD = cabang timnya.
app.get("/report/calendar", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const { from, to } = parseRange(c.req.query("from"), c.req.query("to"));
  const amId = c.req.query("am_id") || undefined;
  const cabang = c.req.query("cabang") || undefined;
  return c.json(await reportCalendar(from, to, amId, cabang, await resolveScope(c.req.header("x-user-id"))));
});

// Drilldown harian Sales Calendar: per-AM + daftar plan (customer/hasil).
app.get("/report/calendar/day", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const date = c.req.query("date") || defaultRange().today;
  const amId = c.req.query("am_id") || undefined;
  const cabang = c.req.query("cabang") || undefined;
  return c.json(await reportCalendarDay(date, amId, cabang, await resolveScope(c.req.header("x-user-id"))));
});

// Push WA nudge ke satu AM (dari panel reminder dashboard). Stub di dev.
app.post("/report/reminders/push", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { am_id?: string; kind?: string; date?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.am_id) return c.json({ error: "am_id wajib" }, 400);
  const kind = (["am", "todo", "zero"] as const).includes(body.kind as "am" | "todo" | "zero")
    ? (body.kind as "am" | "todo" | "zero")
    : "am";
  const date = body.date || defaultRange().today;
  const r = await pushReminderToAm(body.am_id, kind, date);
  return c.json(r, r.sent ? 200 : 502);
});

app.get("/report/reminders-pending", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const date = c.req.query("date") || defaultRange().today;
  return c.json(await reportRemindersPending(date));
});

// Sales Performance (revenue dari accurate_invoice). Default = year-to-date.
app.get("/sales/revenue", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const { from, to } = salesRange(c.req.query("from"), c.req.query("to"));
  return c.json(await reportRevenue(from, to));
});

// Revenue-by-stream (WatchPoint kartu Fafa): revenue per lini produk.
// ?periode=YYYY-MM (menang atas from/to), atau ?from=&to=. Default bulan berjalan.
// Balikan `ringkasan` memuat cakupan klasifikasi & selisih terhadap netto invoice —
// tampilkan keduanya di UI, jangan cuma daftar lininya.
app.get("/reports/revenue-by-stream", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const { from, to } = streamRange(c.req.query("periode"), c.req.query("from"), c.req.query("to"));
  return c.json(await reportRevenueByStream(from, to));
});

// Kartu Sales Performance: target vs realisasi per periode (YTD/kuartal/bulan) +
// breakdown region. Periodik relatif "hari ini" (asOf opsional, YYYY-MM-DD).
app.get("/sales/performance", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await reportSalesPerformance(c.req.query("asOf")));
});

// Sales Targets (menu Admin → Sales Targets). BFF-trusted; role-guard di web.
app.get("/sales/targets", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const year = Number(c.req.query("year")) || new Date().getUTCFullYear();
  return c.json({ year, rows: await listTargets(year) });
});
app.put("/sales/targets", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let b: { year?: number; entries?: { period?: string; region?: string; target?: number }[] } = {};
  try { b = await c.req.json(); } catch { /* opsional */ }
  const year = Number(b.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return c.json({ error: "year tidak valid" }, 400);
  const PERIODS = ["year", "quarter", "month"];
  const REGIONS = ["East", "West"];
  const entries = (b.entries ?? [])
    .filter((e) => PERIODS.includes(String(e.period)) && REGIONS.includes(String(e.region)) && Number.isFinite(Number(e.target)))
    .map((e) => ({ period: e.period as "year" | "quarter" | "month", region: e.region as "East" | "West", target: Math.max(0, Number(e.target)) }));
  return c.json(await upsertTargets(year, entries));
});

// Target per Cabang (tahunan, migration 047). Region turunan dari hod_territory.
app.get("/sales/targets/cabang", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const year = Number(c.req.query("year")) || new Date().getUTCFullYear();
  return c.json({ year, rows: await listCabangTargets(year) });
});
app.put("/sales/targets/cabang", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let b: { year?: number; entries?: { cabang?: string; target?: number }[] } = {};
  try { b = await c.req.json(); } catch { /* opsional */ }
  const year = Number(b.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return c.json({ error: "year tidak valid" }, 400);
  const entries = (b.entries ?? [])
    .filter((e) => String(e.cabang ?? "").trim() !== "" && Number.isFinite(Number(e.target)))
    .map((e) => ({ cabang: String(e.cabang), target: Math.max(0, Number(e.target)) }));
  return c.json(await upsertCabangTargets(year, entries));
});

// Target per AM (tahunan, migration 047). Region turunan dari cabang AM.
app.get("/sales/targets/am", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const year = Number(c.req.query("year")) || new Date().getUTCFullYear();
  const [rows, candidates] = await Promise.all([listAmTargets(year), listAmCandidates(year)]);
  return c.json({ year, rows, candidates });
});
app.put("/sales/targets/am", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let b: { year?: number; entries?: { am_id?: string; target?: number; target_customer?: number }[] } = {};
  try { b = await c.req.json(); } catch { /* opsional */ }
  const year = Number(b.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return c.json({ error: "year tidak valid" }, 400);
  const entries = (b.entries ?? [])
    .filter((e) => String(e.am_id ?? "").trim() !== "" && Number.isFinite(Number(e.target)))
    .map((e) => ({
      am_id: String(e.am_id),
      target: Math.max(0, Number(e.target)),
      // Tak dikirim → undefined (biarkan nilai lama), bukan 0 (menghapus target).
      target_customer: Number.isFinite(Number(e.target_customer)) ? Math.max(0, Number(e.target_customer)) : undefined,
    }));
  return c.json(await upsertAmTargets(year, entries));
});
app.delete("/sales/targets/am", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const year = Number(c.req.query("year")) || new Date().getUTCFullYear();
  const am_id = String(c.req.query("am_id") ?? "").trim();
  if (!am_id) return c.json({ error: "am_id wajib" }, 400);
  return c.json(await deleteAmTarget(year, am_id));
});

// Dashboard Sales Overview (gabungan) — KPI+delta, tren, breakdown, recent, low-stock, AR.
app.get("/dashboard/overview", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const { from, to } = salesRange(c.req.query("from"), c.req.query("to"));
  return c.json(await salesOverview(from, to));
});

// ── F127 Sales Analytics (multi-dimensi; row-level scope via x-user-id) ──
// BFF tepercaya meneruskan identitas user lewat header x-user-id → resolveScope
// (AM → data sendiri). Feature-permission `sales-analytics` dijaga di web BFF.
const scopeOf = (c: { req: { header: (k: string) => string | undefined } }) =>
  resolveScope(c.req.header("x-user-id"));

app.get("/sales-analytics/overview", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await analyticsOverview(c.req.query("from"), c.req.query("to"), await scopeOf(c)));
});
app.get("/sales-analytics/per-am", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await analyticsPerAm(c.req.query("from"), c.req.query("to"), await scopeOf(c)));
});
app.get("/sales-analytics/per-am/:amId/drilldown", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  try {
    return c.json(await analyticsPerAmDrilldown(c.req.param("amId"), c.req.query("from"), c.req.query("to"), await scopeOf(c)));
  } catch (e) {
    const status = (e as { status?: number }).status === 403 ? 403 : 500;
    return c.json({ error: (e as Error).message }, status);
  }
});
app.get("/sales-analytics/per-produk", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await analyticsPerProduk(c.req.query("from"), c.req.query("to"), await scopeOf(c)));
});
app.get("/sales-analytics/per-pengadaan", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await analyticsPerPengadaan(c.req.query("from"), c.req.query("to"), await scopeOf(c)));
});
app.get("/sales-analytics/per-cabang", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await analyticsPerCabang(c.req.query("from"), c.req.query("to"), await scopeOf(c)));
});
app.get("/sales-analytics/per-customer", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await analyticsPerCustomer(c.req.query("from"), c.req.query("to"), await scopeOf(c)));
});
app.get("/sales-analytics/trending", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await analyticsTrending(c.req.query("from"), c.req.query("to"), await scopeOf(c)));
});
// Pacing sbg tab Sales Analytics (berbasis tahun, bukan from/to). Ber-scope
// row-level: AM = target/actual sendiri, HoD = AM & cabang timnya.
app.get("/sales-analytics/pacing", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await targetPacing(Number(c.req.query("year")) || undefined, await scopeOf(c)));
});
// Kinerja Saya — AR aging ber-scope (AM=piutang sendiri, HoD=tim, admin=semua).
app.get("/sales-analytics/my-ar", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await getMyArAging(await scopeOf(c), c.req.query("from"), c.req.query("to")));
});
// Pipeline report (F127 tab "Pipeline"): funnel/forecast/win-loss dari `deal`, row-level scope.
app.get("/sales-analytics/pipeline", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await getPipelineReport(await scopeOf(c)));
});
// Leaderboard AM (F127 tab "Leaderboard"): ranking per-AM dari `deal`, row-level scope.
app.get("/sales-analytics/leaderboard", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await getPipelineLeaderboard(await scopeOf(c)));
});

// ── F66 NPK Engine (per HoD per semester; row-level scope via x-user-id) ──
// Formula SK Pasal 3 (npk-calc.ts). Feature-permission `npk`/`npk-self` + gate
// identitas (admin/hod_key) dijaga di web BFF. Compute = tulis → butuh service-token.
const npkParams = (c: { req: { query: (k: string) => string | undefined } }): { year: number; period: Period } => {
  const cur = currentPeriod();
  const year = Number(c.req.query("year")) || cur.year;
  const p = (c.req.query("period") ?? "").toUpperCase();
  const period: Period = p === "S1" || p === "S2" ? (p as Period) : cur.period;
  return { year, period };
};

app.post("/npk/compute", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const svc = process.env.API_SERVICE_TOKEN;
  if (svc && c.req.header("x-service-token") !== svc) return c.json({ error: "forbidden" }, 403);
  const { year, period } = npkParams(c);
  return c.json(await computeNpk({ year, period }));
});

app.get("/npk/scores", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const { year, period } = npkParams(c);
  return c.json(await getNpkScores(await scopeOf(c), year, period));
});

app.get("/npk/scores/:userId", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const { year, period } = npkParams(c);
  try {
    return c.json(await getNpkDetail(await scopeOf(c), c.req.param("userId"), year, period));
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return c.json({ error: (e as Error).message }, status as 403 | 404 | 500);
  }
});

// ── F66 NPK level AM/Sales (078) — formula SK yang sama, subjek = master_user.am_id.
// Role gate ada di lapisan data (repo/npk-am.ts visibleAms): admin & HoD → semua AM;
// staff AM → hanya dirinya; selain itu kosong. Rute /npk/am/* sengaja TIDAK bentrok
// dengan /npk/scores/:userId (prefix beda), jadi urutan registrasi tak jadi soal.
app.post("/npk/am/compute", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const svc = process.env.API_SERVICE_TOKEN;
  if (svc && c.req.header("x-service-token") !== svc) return c.json({ error: "forbidden" }, 403);
  const { year, period } = npkParams(c);
  return c.json(await computeNpkAm({ year, period }));
});

app.get("/npk/am/scores", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const { year, period } = npkParams(c);
  return c.json(await getNpkAmScores(await scopeOf(c), year, period));
});

app.get("/npk/am/scores/:ref", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const { year, period } = npkParams(c);
  try {
    return c.json(await getNpkAmDetail(await scopeOf(c), c.req.param("ref"), year, period));
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return c.json({ error: (e as Error).message }, status as 403 | 404 | 500);
  }
});

// ── F67 Insentif (093/094) — model console_v2, unit hitung PER TRANSAKSI ──
//
// Aturan akses hidup di lapisan data (repo/insentif.ts resolveVisibleAms), SATU definisi:
// admin/superuser → semua; HoD → AM di cabang timnya; staff AM → dirinya saja; tanpa
// identitas → TERTUTUP. Fail-closed, beda dari menu analitik lain: ini angka penghasilan
// orang, jadi panggilan ber-service-token TANPA x-user-id pun tidak dapat baris siapa pun.
const insentifPeriode = (c: { req: { query: (k: string) => string | undefined } }): string => {
  const p = (c.req.query("periode") ?? "").trim();
  if (/^\d{4}-\d{2}$/.test(p)) return p;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const insentifErr = (e: unknown) => ({
  status: ((e as { status?: number }).status ?? 500) as 403 | 404 | 500,
  body: { error: (e as Error).message },
});

app.get("/insentif/self", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  try {
    return c.json(await getInsentifSelf(await scopeOf(c), insentifPeriode(c)));
  } catch (e) {
    const { status, body } = insentifErr(e);
    return c.json(body, status);
  }
});

app.get("/insentif/list", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  try {
    return c.json(await getInsentifList(await scopeOf(c), insentifPeriode(c)));
  } catch (e) {
    const { status, body } = insentifErr(e);
    return c.json(body, status);
  }
});

// Hitung ulang satu periode. Operasi ops.
//
// Pagar yang SELALU berlaku: superuser (dari sesi via x-user-id). Pagar service-token
// hanya aktif bila API_SERVICE_TOKEN di-set — mengikuti pola rumah (lihat baris 342 dan
// endpoint ops lain), supaya dev tanpa token tetap bisa dipakai. Jadi di lingkungan
// tanpa token, yang menjaga endpoint ini adalah superuser SAJA; jangan membaca komentar
// ini sebagai "wajib dua-duanya".
// apply=false (default) = pratinjau, tak menulis apa pun.
app.post("/insentif/compute", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const svc = process.env.API_SERVICE_TOKEN;
  if (svc && c.req.header("x-service-token") !== svc) return c.json({ error: "forbidden" }, 403);
  const scope = await scopeOf(c);
  if (!scope.superuser) return c.json({ error: "forbidden" }, 403);
  const body = (await c.req.json().catch(() => ({}))) as {
    periode_hpp?: string;
    am_ids?: unknown;
    effort?: Record<string, { effort: number; presales: number }>;
    apply?: boolean;
  };
  return c.json(await computeInsentifPeriode({
    periode: insentifPeriode(c),
    periodeHpp: String(body.periode_hpp ?? "H2-2026"),
    amIds: Array.isArray(body.am_ids) ? body.am_ids.map(String) : [],
    effortPerAm: new Map(Object.entries(body.effort ?? {})),
    apply: body.apply === true,
  }));
});

// :amId ditaruh PALING BAWAH supaya tidak menelan /insentif/self & /insentif/list.
app.get("/insentif/:amId", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  try {
    return c.json(await getInsentifDetail(await scopeOf(c), c.req.param("amId"), insentifPeriode(c)));
  } catch (e) {
    const { status, body } = insentifErr(e);
    return c.json(body, status);
  }
});

// Saved views + threshold alert (per user; butuh x-user-id dari BFF).
const userIdOf = (c: { req: { header: (k: string) => string | undefined } }): string =>
  (c.req.header("x-user-id") ?? "").trim();

app.get("/sales-analytics/views", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const uid = userIdOf(c);
  if (!uid) return c.json({ error: "x-user-id wajib" }, 401);
  return c.json({ views: await listViews(uid) });
});
app.post("/sales-analytics/views", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const uid = userIdOf(c);
  if (!uid) return c.json({ error: "x-user-id wajib" }, 401);
  let b = {};
  try { b = await c.req.json(); } catch { /* opsional */ }
  const r = await saveView(uid, b);
  return r.ok ? c.json(r, 201) : c.json({ error: r.error }, 400);
});
app.delete("/sales-analytics/views/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const uid = userIdOf(c);
  if (!uid) return c.json({ error: "x-user-id wajib" }, 401);
  return (await deleteView(uid, c.req.param("id"))) ? c.json({ ok: true }) : c.json({ error: "view tak ditemukan" }, 404);
});

app.get("/sales-analytics/alerts", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const uid = userIdOf(c);
  if (!uid) return c.json({ error: "x-user-id wajib" }, 401);
  return c.json({ alerts: await listAlerts(uid) });
});
app.post("/sales-analytics/alerts", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const uid = userIdOf(c);
  if (!uid) return c.json({ error: "x-user-id wajib" }, 401);
  let b = {};
  try { b = await c.req.json(); } catch { /* opsional */ }
  const r = await createAlert(uid, b);
  return r.ok ? c.json(r, 201) : c.json({ error: r.error }, 400);
});
app.patch("/sales-analytics/alerts/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const uid = userIdOf(c);
  if (!uid) return c.json({ error: "x-user-id wajib" }, 401);
  let b: { active?: boolean } = {};
  try { b = await c.req.json(); } catch { /* opsional */ }
  return (await updateAlert(uid, c.req.param("id"), b)) ? c.json({ ok: true }) : c.json({ error: "alert tak ditemukan" }, 404);
});
app.delete("/sales-analytics/alerts/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const uid = userIdOf(c);
  if (!uid) return c.json({ error: "x-user-id wajib" }, 401);
  return (await deleteAlert(uid, c.req.param("id"))) ? c.json({ ok: true }) : c.json({ error: "alert tak ditemukan" }, 404);
});
// Kandidat tujuan notif (grup WA + user) utk form alert.
app.get("/sales-analytics/alert-targets", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await listAlertTargets());
});

// ── F76 Executive Command Center (Director Dashboard) — agregasi read-only ──
// COMMAND/OUTLET/KPI = level direktur (full company). AM-RADAR ikut scope x-user-id.
app.get("/executive/command", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await execCommand(await scopeOf(c)));
});
app.get("/executive/am-radar", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await execAmRadar(await scopeOf(c)));
});
app.get("/executive/outlet-matrix", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await execOutletMatrix());
});
app.get("/executive/dormant-intel", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await execDormantIntel());
});
app.get("/executive/kpi-baseline", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await execKpiBaseline());
});
app.get("/executive/rotation", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await execRotation(await scopeOf(c)));
});
app.get("/executive/growth-levers", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const force = c.req.query("refresh") === "1";
  return c.json(await execGrowthLevers(await scopeOf(c), force));
});

// ── F118 Employee Spine (+ F119 bobot BSC) ──
app.get("/employee-spine/departments", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json({ departments: await listDepartments() });
});
app.get("/employee-spine/hods", async (c) => c.json({ hods: getHods() }));
app.get("/employee-spine/employees", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json({ employees: await listEmployees() });
});
app.get("/employee-spine/raci-matrix", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await getRaciMatrix());
});
app.get("/employee-spine/voice", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await getVoiceAggregate());
});
app.get("/employee-spine/hod-resolution", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await getHodResolution());
});
app.get("/employee-spine/org-reporting", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await getOrgReporting());
});
// F121 — persist hod_key dari resolver (admin-gated di BFF web).
app.post("/employee-spine/hod-populate", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await populateHodKey());
});
app.get("/employee-spine/employees/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const e = await getEmployee(c.req.param("id"));
  return e ? c.json(e) : c.json({ error: "karyawan tak ditemukan" }, 404);
});
// F119b KPI measurement per periode (baca + upsert).
app.get("/employee-spine/employees/:id/measurements", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const period = (c.req.query("period") ?? "").trim();
  if (!period) return c.json({ error: "param 'period' wajib (mis. 2026-07)" }, 400);
  return c.json({ period, measurements: await getMeasurements(c.req.param("id"), period) });
});
app.post("/employee-spine/employees/:id/measurements", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { period?: string; items?: MeasurementInput[] };
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON body" }, 400); }
  const period = (body.period ?? "").trim();
  if (!period) return c.json({ error: "field 'period' wajib" }, 400);
  if (!Array.isArray(body.items)) return c.json({ error: "field 'items' wajib array" }, 400);
  return c.json(await saveMeasurements(c.req.param("id"), period, body.items));
});
// F118b CRUD core karyawan (gating admin di BFF web).
app.post("/employee-spine/employees", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: EmployeeWrite;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON body" }, 400); }
  if (!body?.nama?.trim()) return c.json({ error: "field 'nama' wajib" }, 400);
  return c.json(await createEmployee(body), 201);
});
app.patch("/employee-spine/employees/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: EmployeeWrite;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON body" }, 400); }
  if (!body?.nama?.trim()) return c.json({ error: "field 'nama' wajib" }, 400);
  const r = await updateEmployee(c.req.param("id"), body);
  return r.updated ? c.json(r) : c.json({ error: "karyawan tak ditemukan" }, 404);
});
app.delete("/employee-spine/employees/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const r = await deleteEmployee(c.req.param("id"));
  return r.deleted ? c.json(r) : c.json({ error: "karyawan tak ditemukan" }, 404);
});
// F118c replace sub-koleksi profil (transaksional; KPI id-aware jaga measurement).
app.put("/employee-spine/employees/:id/detail", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: SpineDetail;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON body" }, 400); }
  const r = await replaceEmployeeDetail(c.req.param("id"), body);
  return r.ok ? c.json(r) : c.json({ error: "karyawan tak ditemukan" }, 404);
});
// Trigger manual evaluasi semua alert aktif (uji/ops) — kirim WA saat transisi ke breach.
app.post("/sales-analytics/alerts/evaluate", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await evaluateSalesAlerts());
});

// ── F76 WatchPoint HoD (metric-based, DB-backed + fallback manual) ──
app.get("/watchpoint", async (c) => c.json(await getWatchBoard()));

// Kirim ringkasan WatchPoint 1 HoD via WA. Target diisi pemanggil (body.to).
// Pengiriman patuh WA_DRY_RUN (default dry-run → aman, tak kirim live).
app.post("/watchpoint/:hodKey/send-wa", async (c) => {
  const hodKey = c.req.param("hodKey");
  let body: { to?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const to = (body.to ?? "").trim();
  if (!to) return c.json({ error: "field 'to' (nomor/jid WA tujuan) wajib" }, 400);
  const board = await getWatchBoard();
  const hod = board.hods.find((h) => h.key === hodKey);
  if (!hod) return c.json({ error: `HoD '${hodKey}' tidak ditemukan` }, 404);
  const message = formatHodWatchWa(hod, board.asOf);
  const result = await sendViaWaGateway(to, message);
  return c.json({ ...result, hodKey, preview: message }, result.sent ? 200 : 502);
});

// Ubah target / nilai manual satu metric papan "sekarang" (migrasi 080).
// Gate direktur/admin dikerjakan layer WEB (admin-guard.ts) — di sini hanya
// validasi bentuk data + pastikan (hod, metric) memang ada di katalog.
app.put("/watchpoint/metric", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: {
    hod_key?: string; metric_key?: string; actual?: number | null; status?: string | null;
    note?: string | null; target_mode?: string; target_override?: number | null; updated_by?: string | null;
  };
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON body" }, 400); }

  const hodKey = (body.hod_key ?? "").trim();
  const metricKey = (body.metric_key ?? "").trim();
  if (!hodKey || !metricKey) return c.json({ error: "hod_key + metric_key wajib" }, 400);
  if (!findMetricDef(hodKey, metricKey)) {
    return c.json({ error: `metric '${metricKey}' tidak ada pada HoD '${hodKey}'` }, 404);
  }

  const MODES = ["default", "value", "milestone"] as const;
  const targetMode = (body.target_mode ?? "default") as (typeof MODES)[number];
  if (!MODES.includes(targetMode)) return c.json({ error: "target_mode harus default|value|milestone" }, 400);

  const VALID: WatchStatus[] = ["GREEN", "YELLOW", "RED", "NA"];
  const status = body.status == null || body.status === "" ? null : (body.status as WatchStatus);
  if (status !== null && !VALID.includes(status)) return c.json({ error: "status harus GREEN|YELLOW|RED|NA" }, 400);

  const asNum = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
  const actual = asNum(body.actual);
  const targetOverride = asNum(body.target_override);
  if (actual !== null && !Number.isFinite(actual)) return c.json({ error: "actual harus angka" }, 400);
  if (targetOverride !== null && !Number.isFinite(targetOverride)) return c.json({ error: "target_override harus angka" }, 400);
  if (targetMode === "value" && targetOverride === null) {
    return c.json({ error: "target_override wajib diisi saat target_mode='value'" }, 400);
  }

  await upsertWatchMetric({
    hodKey, metricKey, actual, status, note: body.note?.trim() || null,
    targetMode, targetOverride: targetMode === "value" ? targetOverride : null,
    updatedBy: body.updated_by?.trim() || null,
  });
  return c.json({ ok: true });
});

// Hapus baris → target balik ke default kode, nilai manual balik N/A.
app.delete("/watchpoint/metric", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const hodKey = (c.req.query("hod_key") ?? "").trim();
  const metricKey = (c.req.query("metric_key") ?? "").trim();
  if (!hodKey || !metricKey) return c.json({ error: "hod_key + metric_key wajib" }, 400);
  const r = await deleteWatchMetric(hodKey, metricKey);
  return c.json(r, r.deleted ? 200 : 404);
});

// ── F76 WatchPoint — CRUD mapping HoD→cabang (hod_territory) ──
app.get("/watchpoint/territory", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const rows = await listTerritory();
  return c.json({ count: rows.length, rows });
});

app.post("/watchpoint/territory", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { hod_key?: string; cabang?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON body" }, 400); }
  const hod = (body.hod_key ?? "").trim();
  const cabang = (body.cabang ?? "").trim();
  if (!hod || !cabang) return c.json({ error: "hod_key + cabang wajib" }, 400);
  return c.json(await createTerritory(hod, cabang), 201);
});

app.put("/watchpoint/territory/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { hod_key?: string; cabang?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON body" }, 400); }
  const hod = (body.hod_key ?? "").trim();
  const cabang = (body.cabang ?? "").trim();
  if (!hod || !cabang) return c.json({ error: "hod_key + cabang wajib" }, 400);
  try {
    const r = await updateTerritory(c.req.param("id"), hod, cabang);
    return r ? c.json(r) : c.json({ error: "not found" }, 404);
  } catch {
    return c.json({ error: "kombinasi hod_key+cabang sudah ada" }, 409);
  }
});

app.delete("/watchpoint/territory/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const r = await deleteTerritory(c.req.param("id"));
  return c.json(r, r.deleted ? 200 : 404);
});

// ── WatchPoint Weekly — papan per minggu ISO + snapshot + deck PPTX ──
// Minggu default = minggu berjalan (WIB). Query ?year=&week= untuk minggu lain.
function weekParam(c: { req: { query: (k: string) => string | undefined } }): { isoYear: number; isoWeek: number } | null {
  const cur = currentWeek();
  const y = c.req.query("year");
  const w = c.req.query("week");
  if (y === undefined && w === undefined) return cur;
  const isoYear = Number(y ?? cur.isoYear);
  const isoWeek = Number(w ?? cur.isoWeek);
  if (!Number.isInteger(isoYear) || isoYear < 2000 || isoYear > 2100) return null;
  if (!Number.isInteger(isoWeek) || isoWeek < 1 || isoWeek > 53) return null;
  return { isoYear, isoWeek };
}

app.get("/watchpoint/weekly", async (c) => {
  const w = weekParam(c);
  if (!w) return c.json({ error: "year/week tidak valid" }, 400);
  return c.json(await getWeeklyBoard(w.isoYear, w.isoWeek));
});

app.get("/watchpoint/weekly/weeks", async (c) => {
  const back = Number(c.req.query("back") ?? 12);
  return c.json({ rows: await listWeeks(Number.isInteger(back) && back > 0 && back <= 104 ? back : 12) });
});

// Bekukan nilai computed minggu tsb ke tabel (idempoten). Metric manual HoD
// tidak tergilas — lihat snapshotWeek().
app.post("/watchpoint/weekly/snapshot", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { year?: number; week?: number; mode?: string } = {};
  try { body = await c.req.json(); } catch { /* body opsional → minggu berjalan */ }
  const cur = currentWeek();
  const isoYear = Number(body.year ?? cur.isoYear);
  const isoWeek = Number(body.week ?? cur.isoWeek);
  if (!Number.isInteger(isoYear) || !Number.isInteger(isoWeek) || isoWeek < 1 || isoWeek > 53) {
    return c.json({ error: "year/week tidak valid" }, 400);
  }
  // mode 'reconstruct' = isi mundur minggu lampau. Hanya metric capaian periode
  // yang sumbernya menjangkau minggu itu yang dibekukan; ar90/noorder/churn/
  // fia/xsell dilewati karena tak bisa direkonstruksi (lihat snapshotWeek).
  if (body.mode !== undefined && body.mode !== "live" && body.mode !== "reconstruct") {
    return c.json({ error: "mode harus live|reconstruct" }, 400);
  }
  return c.json(await snapshotWeek(isoYear, isoWeek, body.mode === "reconstruct" ? "reconstruct" : "live"));
});

// Input manual HoD untuk satu metric di satu minggu (uptime, lead time, JV, dst).
app.put("/watchpoint/weekly/metric", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: {
    hod_key?: string; metric_key?: string; year?: number; week?: number;
    target?: number | null; actual?: number | null; status?: string | null; note?: string | null;
  };
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON body" }, 400); }

  const hodKey = (body.hod_key ?? "").trim();
  const metricKey = (body.metric_key ?? "").trim();
  if (!hodKey || !metricKey) return c.json({ error: "hod_key + metric_key wajib" }, 400);

  const cur = currentWeek();
  const isoYear = Number(body.year ?? cur.isoYear);
  const isoWeek = Number(body.week ?? cur.isoWeek);
  if (!Number.isInteger(isoYear) || !Number.isInteger(isoWeek) || isoWeek < 1 || isoWeek > 53) {
    return c.json({ error: "year/week tidak valid" }, 400);
  }

  const VALID: WatchStatus[] = ["GREEN", "YELLOW", "RED", "NA"];
  const status = body.status == null || body.status === "" ? null : (body.status as WatchStatus);
  if (status !== null && !VALID.includes(status)) return c.json({ error: "status harus GREEN|YELLOW|RED|NA" }, 400);

  const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
  const actual = num(body.actual);
  const target = num(body.target);
  if (actual !== null && !Number.isFinite(actual)) return c.json({ error: "actual harus angka" }, 400);
  if (target !== null && !Number.isFinite(target)) return c.json({ error: "target harus angka" }, 400);

  await upsertWeeklyMetric({
    hod_key: hodKey, metric_key: metricKey, iso_year: isoYear, iso_week: isoWeek,
    target, actual, status, note: body.note?.trim() || null,
  });
  return c.json({ ok: true });
});

// Hapus input manual → metric balik ke nilai live/snapshot.
app.delete("/watchpoint/weekly/metric", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const w = weekParam(c);
  const hodKey = (c.req.query("hod_key") ?? "").trim();
  const metricKey = (c.req.query("metric_key") ?? "").trim();
  if (!w) return c.json({ error: "year/week tidak valid" }, 400);
  if (!hodKey || !metricKey) return c.json({ error: "hod_key + metric_key wajib" }, 400);
  const r = await deleteWeeklyMetric(hodKey, w.isoYear, w.isoWeek, metricKey);
  return c.json(r, r.deleted ? 200 : 404);
});

// Deck PPTX minggu tsb. ?hod=<key> → deck 1 HoD saja.
app.get("/watchpoint/weekly/pptx", async (c) => {
  const w = weekParam(c);
  if (!w) return c.json({ error: "year/week tidak valid" }, 400);
  const hodKey = c.req.query("hod")?.trim() || undefined;
  const board = await getWeeklyBoard(w.isoYear, w.isoWeek);
  if (hodKey && !board.hods.some((h) => h.key === hodKey)) {
    return c.json({ error: `HoD '${hodKey}' tidak ditemukan` }, 404);
  }
  const buf = await buildWeeklyDeck(board, hodKey);
  const name = hodKey ? weeklyDeckFilename(board).replace(".pptx", `-${hodKey}.pptx`) : weeklyDeckFilename(board);
  return c.body(new Uint8Array(buf), 200, {
    "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "content-disposition": `attachment; filename="${name}"`,
    "cache-control": "no-store",
  });
});

// Kirim ringkasan WatchPoint mingguan 1 HoD via WA (patuh WA_DRY_RUN).
app.post("/watchpoint/weekly/:hodKey/send-wa", async (c) => {
  const hodKey = c.req.param("hodKey");
  let body: { to?: string; year?: number; week?: number };
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON body" }, 400); }
  const to = (body.to ?? "").trim();
  if (!to) return c.json({ error: "field 'to' (nomor/jid WA tujuan) wajib" }, 400);

  const cur = currentWeek();
  const isoYear = Number(body.year ?? cur.isoYear);
  const isoWeek = Number(body.week ?? cur.isoWeek);
  if (!Number.isInteger(isoYear) || !Number.isInteger(isoWeek) || isoWeek < 1 || isoWeek > 53) {
    return c.json({ error: "year/week tidak valid" }, 400);
  }

  const board = await getWeeklyBoard(isoYear, isoWeek);
  const hod = board.hods.find((h) => h.key === hodKey);
  if (!hod) return c.json({ error: `HoD '${hodKey}' tidak ditemukan` }, 404);
  const message = formatWeeklyHodWa(board, hod);
  const result = await sendViaWaGateway(to, message);
  return c.json({ ...result, hodKey, week: board.label, preview: message }, result.sent ? 200 : 502);
});

// ── Price Book (F142) — katalog harga produk KEAGENAN per periode ───────────
// Isi tabel dari importer scripts/db/import_pricebook.py (data tidak di repo).
// Gate akses ada di BFF (apps/web /api/pricebook/*): katalog utk semua user
// berizin, ringkasan hanya Direktur/admin.
app.get("/pricebook/items", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const q = c.req.query();
  const rows = await listPricebookItems({
    periode: q.periode, lini: q.lini, brand: q.brand, kategori: q.kategori,
    q: q.q, limit: q.limit ? Number(q.limit) : undefined,
  });
  return c.json({ count: rows.length, rows });
});

app.get("/pricebook/summary", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await pricebookSummary(c.req.query("periode") || undefined));
});

app.get("/pricebook/outside", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const q = c.req.query();
  const rows = await outsideKeagenan({
    periode: q.periode, q: q.q, limit: q.limit ? Number(q.limit) : undefined,
  });
  return c.json({ count: rows.length, rows });
});

app.get("/pricebook/periode", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json({ rows: await pricebookPeriode() });
});

// Lapisan Pricelist Setup (migrasi 073): HPP, margin turunan & klasifikasi per SKU.
// INTERNAL — gate-nya di halaman /pricelist/setup (canEditPricelistSetup:
// HoD Business / Purchasing / admin). JANGAN dipakai halaman AM: /pricebook yang
// dilihat sales tidak boleh menyentuh endpoint ini.
app.get("/pricebook/setup", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const q = c.req.query();
  const periode = q.periode || undefined;
  const [rows, ringkas] = await Promise.all([
    listPricebookSetup({ periode, q: q.q, lini: q.lini, limit: q.limit ? Number(q.limit) : undefined }),
    pricebookSetupSummary(periode),
  ]);
  return c.json({ count: rows.length, rows, ringkas });
});

// ── Simulator KSO (migrasi 074) — master alat, reagen & parameter ───────────
// Isi tabel dari importer scripts/db/import_kso_master.py (data tidak di repo).
// Read-only: perhitungan running cost jalan di browser (apps/web/src/lib/kso/
// formula.ts) karena user mengubah harga & jumlah test terus-menerus saat
// menyusun penawaran — bolak-balik ke server tiap ketikan tidak masuk akal.
// Gate akses ada di BFF (apps/web /api/kso/*).
app.get("/kso/master", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await ksoMaster());
});

// Setelan harga keagenan (migrasi 077). Gate di halaman /pricebook/setup
// (HoD Business / Purchasing / admin) — endpoint ini memuat HPP.
app.patch("/pricebook/setup", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: PricebookSetupPatch;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON body" }, 400); }
  const res = await updatePricebookSetupRow(body);
  return res.ok ? c.json(res.row) : c.json({ error: res.error }, 400);
});

app.post("/pricebook/setup/publish", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const b = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const rows = Array.isArray(b.rowNos) ? (b.rowNos as unknown[]).map(Number).filter(Number.isInteger) : undefined;
  return c.json(await publishPricebookSetup(rows, (b.by as string) ?? null, (b.periode as string) || undefined));
});

app.post("/pricebook/setup/unpublish", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const b = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const rows = Array.isArray(b.rowNos) ? (b.rowNos as unknown[]).map(Number).filter(Number.isInteger) : undefined;
  return c.json(await unpublishPricebookSetup(rows, (b.periode as string) || undefined));
});

// Harga keagenan TERPUBLIKASI — ini yang dibuka Account Manager. Tanpa HPP &
// margin: kolomnya tidak di-SELECT sama sekali, jadi tak ada jalan bocor.
// Export PDF daftar harga terpublikasi. POST (bukan GET) karena daftar row_no
// yang dicentang user bisa ratusan — terlalu panjang untuk query string.
app.post("/pricebook/published/pdf", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const b = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const rowNos = Array.isArray(b.rowNos)
    ? (b.rowNos as unknown[]).map(Number).filter(Number.isInteger) : undefined;
  const pdf = await pricelistPdf({
    periode: (b.periode as string) || undefined,
    rowNos,
    oleh: (b.oleh as string) ?? null,
  });
  return c.body(new Uint8Array(pdf), 200, {
    "content-type": "application/pdf",
    "content-disposition": `attachment; filename="daftar-harga-keagenan.pdf"`,
  });
});

app.get("/pricebook/published", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const q = c.req.query();
  const rows = await listPublishedKeagenan({
    periode: q.periode, q: q.q, lini: q.lini, limit: q.limit ? Number(q.limit) : undefined,
  });
  return c.json({ count: rows.length, rows });
});

// ── Klasifikasi produk & kode produk (migrasi 072) ──────────────────────────
// Kode KK.PP.CC.SSS.NNNN. Isi awal dari importer
// scripts/db/import_product_classification.py (data tidak di repo).
// Gate akses ada di BFF (apps/web /api/klasifikasi/*): lihat utk user berizin,
// tulis hanya HoD Business/Purchasing/admin.
app.get("/klasifikasi/taxonomy", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json({ rows: await klasifikasiTaxonomy() });
});

app.get("/klasifikasi/summary", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await klasifikasiSummary());
});

app.get("/klasifikasi/codes", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const q = c.req.query();
  const rows = await listKlasifikasiCodes({
    kategoriId: q.kategori, lineId: q.line, classId: q.class, subClassId: q.sub_class,
    sumber: q.sumber, q: q.q, limit: q.limit ? Number(q.limit) : undefined,
  });
  return c.json({ count: rows.length, rows });
});

// Pratinjau kode berikutnya — TIDAK menyimpan apa pun (bukan reservasi nomor).
app.get("/klasifikasi/next-kode", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const q = c.req.query();
  if (!q.kategori || !q.line || !q.class || !q.sub_class) {
    return c.json({ error: "butuh query kategori, line, class, sub_class" }, 400);
  }
  const r = await nextKlasifikasiKode(q.kategori, q.line, q.class, q.sub_class);
  return r.ok ? c.json(r.data) : c.json({ error: r.error }, 400);
});

app.post("/klasifikasi/codes", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: KlasifikasiCodeInput;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON body" }, 400); }
  const r = await createKlasifikasiCode(body);
  return r.ok ? c.json({ kode: r.kode }, 201) : c.json({ error: r.error }, 400);
});

app.post("/klasifikasi/taxonomy", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: KlasifikasiNodeInput;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON body" }, 400); }
  const r = await upsertKlasifikasiNode(body);
  return r.ok ? c.json({ ok: true }) : c.json({ error: r.error }, 400);
});

app.delete("/klasifikasi/taxonomy", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const q = c.req.query();
  const level = q.level as KlasifikasiLevel;
  if (!level || !q.kategori || !q.id) {
    return c.json({ error: "butuh query level, kategori, id (+ class untuk sub_class)" }, 400);
  }
  const r = await deleteKlasifikasiNode(level, q.kategori, q.id, q.class);
  return r.ok ? c.json({ ok: true }) : c.json({ error: r.error }, 409);
});

app.get("/klasifikasi/review", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const q = c.req.query();
  const rows = await listKlasifikasiReview(q.status || undefined,
    q.limit ? Number(q.limit) : undefined);
  return c.json({ count: rows.length, rows });
});

// Pilihan sub class di bawah induk baris antrean — bahan dialog "Selesaikan".
app.get("/klasifikasi/review/:id/sub-class", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const res = await klasifikasiSubClassPilihan(Number(c.req.param("id")));
  return res.ok ? c.json(res) : c.json({ error: res.error }, 400);
});

// Selesaikan baris antrean: daftarkan/pilih sub class → terbitkan kode → tandai
// beres, dalam satu transaksi. Menggantikan tombol lama yang cuma mengubah status.
app.post("/klasifikasi/review/:id/selesaikan", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const b = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const res = await selesaikanKlasifikasiReview(Number(c.req.param("id")), {
    subClassId: (b.subClassId as string) ?? null,
    subClassNama: (b.subClassNama as string) ?? null,
    akuiNamaSama: b.akuiNamaSama === true,
    by: ((b.by ?? b.createdBy) as string) ?? null,
  });
  return res.ok ? c.json(res) : c.json({ error: res.error }, 400);
});

app.post("/klasifikasi/review/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { status?: string };
  try { body = await c.req.json(); } catch { body = {}; }
  const r = await setKlasifikasiReviewStatus(Number(c.req.param("id")), body.status ?? "");
  return r.ok ? c.json({ ok: true }) : c.json({ error: r.error }, 400);
});

// ── Pricelist — harga jual per produk (setup HoD/Purchasing → publish → AM) ──
// Role-guard ada di BFF (apps/web /api/pricelist*); di sini hanya validasi DB.
app.get("/pricelist", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const status = c.req.query("status");
  const rows = await listPricelist(status === "draft" || status === "published" ? status : undefined);
  return c.json({ count: rows.length, rows });
});

app.post("/pricelist", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: PricelistInput;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON body" }, 400); }
  if (body.product_id == null || body.product_id === "") return c.json({ error: "product_id wajib" }, 400);
  const row = await upsertPricelist(body);
  return row ? c.json(row, 201) : c.json({ error: "gagal menyimpan" }, 400);
});

app.post("/pricelist/publish", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { ids?: string[]; published_by?: string };
  try { body = await c.req.json(); } catch { body = {}; }
  return c.json(await publishPricelist(body.ids, body.published_by ?? null));
});

app.post("/pricelist/unpublish", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { ids?: string[] };
  try { body = await c.req.json(); } catch { body = {}; }
  return c.json(await unpublishPricelist(body.ids));
});

app.delete("/pricelist/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const r = await deletePricelist(c.req.param("id"));
  return c.json(r, r.deleted ? 200 : 404);
});

// ── Accurate master mirror (port legacy accurate_customer/item/branch) ──
async function accBody<T>(c: Context): Promise<T[] | null> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return null;
  }
  if (Array.isArray(body)) return body as T[];
  const b = body as { records?: unknown; data?: unknown };
  if (Array.isArray(b.records)) return b.records as T[];
  if (Array.isArray(b.data)) return b.data as T[];
  return null;
}

app.post("/accurate/customers", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const recs = await accBody<{ id: number; no?: string; name?: string; branch_id?: number; raw?: unknown }>(c);
  if (!recs) return c.json({ error: "body array / {records|data:[...]} wajib" }, 400);
  return c.json({ upserted: await upsertCustomers(recs) }, 201);
});

app.post("/accurate/branches", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const recs = await accBody<{ id: number; name?: string; suspended?: boolean; raw?: unknown }>(c);
  if (!recs) return c.json({ error: "body array / {records|data:[...]} wajib" }, 400);
  return c.json({ upserted: await upsertBranches(recs) }, 201);
});

app.post("/accurate/items", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const recs = await accBody<{ id: number; no?: string; name?: string; category?: string; unit_price?: number; raw?: unknown }>(c);
  if (!recs) return c.json({ error: "body array / {records|data:[...]} wajib" }, 400);
  return c.json({ upserted: await upsertItems(recs) }, 201);
});

app.get("/accurate/:entity", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const entity = c.req.param("entity");
  if (entity !== "customers" && entity !== "items" && entity !== "branches" && entity !== "vendors") {
    return c.json({ error: "entity harus customers|items|branches|vendors" }, 400);
  }
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 100, 1), 10000);
  const rows = await listMirror(entity, limit);
  return c.json({ entity, count: rows.length, rows });
});

// ── F37 Cross-Branch Stock Visibility — stok per gudang + korelasi ke total ──
// Fungsi KEDUA di menu /inventory (fungsi pertama = cek stok agregat, lihat
// GET /accurate/items di atas). Read-only: data masuk lewat importer
// scripts/db/import_stock_branch.py, bukan lewat endpoint ini.
app.get("/stock/warehouses", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const rows = await listWarehouses({ aktifSaja: c.req.query("aktif") === "1" });
  return c.json({ count: rows.length, warehouses: rows });
});

app.get("/stock/branch", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const wh = c.req.query("warehouse");
  if (wh) {
    // Validasi terhadap master supaya typo tidak balik "0 baris" yang
    // menyesatkan (kelihatan seperti "gudang ini kosong").
    const known = await listWarehouses();
    if (!known.some((w) => w.kode === wh)) {
      return c.json({ error: `warehouse tak dikenal: ${wh}`, valid: known.map((w) => w.kode) }, 400);
    }
  }
  const out = await listStockBranch({
    q: c.req.query("q") ?? undefined,
    warehouse: wh ?? undefined,
    hanyaSelisih: c.req.query("selisih") === "1",
    hanyaNegatif: c.req.query("negatif") === "1",
    tanpaData: c.req.query("tanpa_data") === "1",
    limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
    offset: c.req.query("offset") ? Number(c.req.query("offset")) : undefined,
  });
  return c.json({ count: out.rows.length, total_rows: out.total_rows, rows: out.rows });
});

app.get("/stock/branch/summary", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await stockBranchSummary());
});

// ── F38 ED Watch & Near-Expiry — stok per batch + tanggal kedaluwarsa ────────
// Read-only; data masuk lewat scripts/db/import_stock_batch.py.
app.get("/stock/batch", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const wh = c.req.query("warehouse");
  if (wh) {
    const known = await listWarehouses();
    if (!known.some((w) => w.kode === wh)) {
      return c.json({ error: `warehouse tak dikenal: ${wh}`, valid: known.map((w) => w.kode) }, 400);
    }
  }
  const tierRaw = c.req.query("tier");
  if (tierRaw && !["30", "60", "90"].includes(tierRaw)) {
    return c.json({ error: "tier harus 30|60|90" }, 400);
  }
  const out = await listStockBatch({
    q: c.req.query("q") ?? undefined,
    warehouse: wh ?? undefined,
    tier: tierRaw ? (Number(tierRaw) as 30 | 60 | 90) : undefined,
    hanyaLewat: c.req.query("lewat") === "1",
    tanpaEd: c.req.query("tanpa_ed") === "1",
    limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
    offset: c.req.query("offset") ? Number(c.req.query("offset")) : undefined,
  });
  return c.json({ count: out.rows.length, total_rows: out.total_rows, rows: out.rows });
});

app.get("/stock/batch/summary", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await stockBatchSummary());
});

// Trigger manual cron ed-watch (test & recovery kalau scheduler mati).
// `tanggal` opsional — default hari ini WIB; dipakai menguji ambang tanpa
// menunggu tanggal sungguhan bergerak.
app.post("/stock/batch/ed-watch/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch { /* body opsional */ }
  // Validasi inline, sengaja tanpa helper bernama: branch F45 mendeklarasikan
  // `isIsoDate` di file ini juga, jadi helper bernama sama akan bentrok saat
  // kedua branch merge. Regex saja tidak cukup — "2026-13-45" lolos pola tapi
  // mati di cast ::date, jadi dicek round-trip.
  if (body.tanggal != null) {
    const t = String(body.tanggal);
    const d = new Date(`${t}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t) {
      return c.json({ error: "tanggal harus tanggal valid (YYYY-MM-DD)" }, 400);
    }
  }
  return c.json(await runEdWatch({
    to: body.to == null ? undefined : String(body.to),
    tanggal: body.tanggal == null ? undefined : String(body.tanggal),
    // Dengan `tanggal` override, penandaan HARUS diminta eksplisit — lihat
    // catatan di runEdWatch: alat uji tak boleh mematikan alert produksi.
    tandai: body.tandai === true,
  }));
});

// ── Log operasional: delivery / email / alert (port legacy *_log) ──
app.post("/logs/delivery", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let b: Record<string, unknown> = {};
  try { b = await c.req.json(); } catch { return c.json({ error: "invalid JSON body" }, 400); }
  return c.json(await recordDelivery(b as Parameters<typeof recordDelivery>[0]), 201);
});

app.post("/logs/email", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let b: { kind?: string; subject?: string } = {};
  try { b = await c.req.json(); } catch { return c.json({ error: "invalid JSON body" }, 400); }
  if (!b.kind || !b.subject) return c.json({ error: "kind + subject wajib" }, 400);
  return c.json(await recordEmail(b as Parameters<typeof recordEmail>[0]), 201);
});

app.post("/logs/alert", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let b: { kind?: string; title?: string } = {};
  try { b = await c.req.json(); } catch { return c.json({ error: "invalid JSON body" }, 400); }
  if (!b.kind || !b.title) return c.json({ error: "kind + title wajib" }, 400);
  return c.json(await recordAlert(b as Parameters<typeof recordAlert>[0]), 201);
});

app.get("/logs/:type", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const type = c.req.param("type");
  if (type !== "delivery" && type !== "email" && type !== "alert") {
    return c.json({ error: "type harus delivery|email|alert" }, 400);
  }
  const rows = await listLogs(type);
  return c.json({ type, count: rows.length, rows });
});

// ── Export dokumen → HTML siap-print (port legacy export_pdf, tanpa lib PDF) ──
app.get("/export/sales-doc/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const html = await renderSalesDocHtml(c.req.param("id"));
  if (!html) return c.json({ error: "dokumen tidak ditemukan" }, 404);
  return c.html(html);
});

app.get("/export/briefing/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const html = await renderBriefingHtml(c.req.param("id"));
  if (!html) return c.json({ error: "briefing tidak ditemukan" }, 404);
  return c.html(html);
});

// HOD daily reminder — rekap kepatuhan plan/report (port cron_hod_daily_reminder).
app.post("/reminders/hod/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { to?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    /* body opsional */
  }
  return c.json(await runHodDaily(body.to), 201);
});

// Read model draft penagihan (status: draft|approved|sent|canceled).
app.get("/ar/collection-drafts", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const status = c.req.query("status") || undefined;
  const drafts = await listCollectionDrafts(status);
  return c.json({ count: drafts.length, drafts });
});

// Siklus kirim A3 (aksi manusia, Layer 5): approve → send → (atau cancel).
app.post("/ar/collection-drafts/:id/approve", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { approver_id?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    /* body opsional */
  }
  const r = await approveCollectionDraft(c.req.param("id"), body.approver_id);
  return c.json(r, r.ok ? 200 : 400);
});

app.post("/ar/collection-drafts/:id/send", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { to?: string; approver_id?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.to) return c.json({ error: "body.to (tujuan WA) wajib" }, 400);
  const r = await sendCollectionDraft(c.req.param("id"), body.to, body.approver_id);
  return c.json(r, r.ok ? 200 : 400);
});

app.post("/ar/collection-drafts/:id/cancel", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { approver_id?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    /* body opsional */
  }
  const r = await cancelCollectionDraft(c.req.param("id"), body.approver_id);
  return c.json(r, r.ok ? 200 : 400);
});

// ── CRM reminder AM (port legacy am_reminder) ──
app.post("/reminders", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { am_id?: string; am_name?: string; reminder_date?: string; note?: string; customer_name?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.am_id || !body.reminder_date || !body.note) {
    return c.json({ error: "am_id, reminder_date (YYYY-MM-DD), note wajib" }, 400);
  }
  // Write-guard row-level: AM murni hanya boleh bikin reminder atas namanya
  // sendiri (kalau tidak, dia bisa menitipkan reminder ke AM lain padahal
  // kalendernya sendiri saja yang terlihat).
  const scope = await resolveScope(c.req.header("x-user-id"));
  if (scope.amOnly && scope.amId && body.am_id !== scope.amId) {
    return c.json({ error: "forbidden — hanya boleh membuat reminder untuk diri sendiri" }, 403);
  }
  const id = await createReminder({
    am_id: body.am_id,
    am_name: body.am_name,
    reminder_date: body.reminder_date,
    note: body.note,
    customer_name: body.customer_name,
  });
  return c.json({ id }, 201);
});

app.patch("/reminders/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { am_name?: string; reminder_date?: string; note?: string; customer_name?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const r = await updateReminder(c.req.param("id"), {
    am_name: body.am_name,
    reminder_date: body.reminder_date,
    note: body.note,
    customer_name: body.customer_name,
  });
  return c.json(r, r.updated ? 200 : 404);
});

app.delete("/reminders/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const r = await deleteReminder(c.req.param("id"));
  return c.json(r, r.deleted ? 200 : 404);
});

app.get("/reminders", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const reminders = await listReminders();
  return c.json({ count: reminders.length, reminders });
});

// Fire reminder due untuk mode (h | h-minus-1). Body opsional { to }.
app.post("/reminders/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { mode?: string; to?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    /* body opsional */
  }
  const mode: ReminderMode = body.mode === "h-minus-1" ? "h-minus-1" : "h";
  const r = await runReminders(mode, body.to);
  return c.json(r, r.count > 0 ? 201 : 200);
});

// Status penjadwal agen (cron in-process) — observabilitas konfigurasi.
app.get("/agents/schedule", (c) => c.json(getScheduleStatus()));

// ── WhatsApp raw store (D1b): feeder pesan mentah → wa_message ──
app.post("/wa/messages", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { messages?: WaMessageInput[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return c.json({ error: "body.messages (array non-kosong) wajib" }, 400);
  }
  return c.json(await ingestWaMessages(body.messages), 201);
});

// Webhook gateway WA (openclaw) → wa_message. Menerima record format tap
// openclaw (single | array | {messages:[...]} | {events:[...]}). Idempoten
// (skip duplikat by input_hash). Jika WA_WEBHOOK_SECRET di-set, header
// x-wa-secret wajib cocok.
app.post("/webhooks/wa", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const secret = process.env.WA_WEBHOOK_SECRET;
  if (secret && c.req.header("x-wa-secret") !== secret) {
    return c.json({ error: "unauthorized" }, 401);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  // Normalisasi ke array record openclaw.
  let records: OpenclawRecord[];
  if (Array.isArray(body)) records = body as OpenclawRecord[];
  else if (body && typeof body === "object") {
    const b = body as { messages?: unknown; events?: unknown };
    if (Array.isArray(b.messages)) records = b.messages as OpenclawRecord[];
    else if (Array.isArray(b.events)) records = b.events as OpenclawRecord[];
    else records = [body as OpenclawRecord]; // single record
  } else {
    return c.json({ error: "payload tidak dikenali" }, 400);
  }
  if (records.length === 0) return c.json({ ingested: 0, skipped: 0, groups: [] });
  const result = await ingestOpenclawMessages(records);
  // Proses inbound (#PLAN/#REPORT → tabel + balas) bila WA_INBOUND_PROCESS=true.
  // Self-guard di processUnprocessed; balasan patuh WA_DRY_RUN (default dry-run).
  let inbound;
  if (isInboundEnabled()) {
    try {
      inbound = await processUnprocessed();
    } catch (e) {
      console.error("[webhooks/wa] inbound process gagal:", e);
    }
  }
  return c.json({ ...result, inbound }, 201);
});

// Trigger manual / batch pemrosesan inbound yang belum diproses (selain auto dari
// webhook). Berguna untuk catch-up. Self-guard WA_INBOUND_PROCESS.
app.post("/wa/inbound/process", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { limit?: number } = {};
  try {
    body = await c.req.json();
  } catch {
    /* body opsional */
  }
  const limit = Math.min(Number(body.limit ?? 50) || 50, 500);
  return c.json(await processUnprocessed(limit));
});

// A1 Distillation Cascade agent — baca wa_message (raw) → distilasi via
// services/ai (/rekap) → simpan digest_rekap + log ke audit_log (D6/D1b).
app.post("/agents/a1/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { group_jid?: string; window_hours?: number } = {};
  try {
    body = await c.req.json();
  } catch {
    // body opsional — default: semua grup, window 5 jam.
  }
  const r = await runDistillationCascade({
    groupJid: body.group_jid,
    windowHours: body.window_hours,
  });
  return c.json(r, r.distilled ? 201 : 200);
});

// ── Customers read model (diturunkan dari deal) ──
app.get("/customers", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const amId = c.req.query("am_id") || undefined;
  const customers = await getCustomers(amId, await scopeOf(c));
  return c.json({ count: customers.length, customers });
});

// F62 Account & Contact 360 (Fase 1) — account = accurate_customer + ekstensi CRM + kontak.
// Ber-scope via pemilik eksplisit crm_account.owner_am_id (migrasi 064).
app.get("/accounts", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const rows = await listAccounts(await scopeOf(c));
  return c.json({ count: rows.length, accounts: rows });
});
app.get("/accounts/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const a = await getAccount(c.req.param("id"), await scopeOf(c));
  return a ? c.json(a) : c.json({ error: "account tak ditemukan" }, 404);
});
app.patch("/accounts/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  try { return c.json(await upsertAccountFields(c.req.param("id"), await c.req.json(), await scopeOf(c))); }
  catch (e) { return c.json({ error: String((e as Error).message) }, 400); }
});
app.post("/accounts/:id/contacts", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  try { return c.json(await createContact(c.req.param("id"), await c.req.json(), await scopeOf(c)), 201); }
  catch (e) { return c.json({ error: String((e as Error).message) }, 400); }
});
app.patch("/accounts/:id/contacts/:cid", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  try { return c.json(await updateContact(c.req.param("cid"), await c.req.json(), await scopeOf(c))); }
  catch (e) { return c.json({ error: String((e as Error).message) }, 400); }
});
app.delete("/accounts/:id/contacts/:cid", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  try { return c.json(await deleteContact(c.req.param("cid"), await scopeOf(c))); }
  catch (e) { return c.json({ error: String((e as Error).message) }, 400); }
});

// Daftar AM utk pemilihan pemilik akun (dropdown "Pemilik"). HoD hanya melihat
// AM di cabang timnya — sekalian jadi batas pilihan yang ditegakkan di write-guard.
app.get("/accounts-owners", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json({ owners: await listOwnerCandidates(await scopeOf(c)) });
});

// Monitoring revenue ter-faktur per customer (total/faktur/transaksi terakhir/dormant).
app.get("/customers/revenue", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await customersRevenue(await scopeOf(c)));
});

// Win-back: customer dormant ≥ ?days (default 60), prioritas revenue historis.
app.get("/customers/dormant", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await dormantCustomers(Number(c.req.query("days")) || 60, await scopeOf(c)));
});

// F77 Churn Early Warning — klasifikasi 3-tier per customer (active/risk/watch).
// ?days=N ambang no-order (default 60). Read-only (Fase 1, tanpa WA/cron).
app.get("/customers/churn", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await churnCustomers(Number(c.req.query("days")) || 60, await scopeOf(c)));
});

// Rincian revenue per bulan satu customer (on-demand). ?months=N (default 12).
app.get("/customers/:id/monthly", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const id = c.req.param("id");
  if (!id || Number.isNaN(Number(id))) return c.json({ error: "id invalid" }, 400);
  const months = Math.min(Math.max(Number(c.req.query("months")) || 12, 1), 36);
  return c.json(await customerMonthly(id, months, await scopeOf(c)));
});

// ── Pipeline read model (dashboard): deal per-stage ──
app.get("/pipeline", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  // Row-level scope via x-user-id (AM → deal sendiri, HoD → cabang, admin → semua).
  return c.json(await getPipeline(await scopeOf(c)));
});

// F1-SPT: transisi stage satu deal (drag kanban / aksi manual). Write-guard +
// gate Closing-Lost (loss_reason wajib) + timeline spt_state_log. Body:
// { to_stage: string, loss_reason?: string, note?: string }.
app.patch("/deals/:id/stage", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const scope = await scopeOf(c);
  const body = await c.req.json().catch(() => ({}));
  const toStage = typeof body?.to_stage === "string" ? body.to_stage : "";
  if (!toStage) return c.json({ error: "to_stage wajib" }, 400);
  try {
    const res = await transitionStage(c.req.param("id"), toStage, scope, {
      lossReason: typeof body?.loss_reason === "string" ? body.loss_reason : undefined,
      note: typeof body?.note === "string" ? body.note : undefined,
    });
    return c.json(res);
  } catch (e) {
    if (e instanceof DealError) return c.json({ error: e.message }, e.status as 400 | 403 | 404);
    throw e;
  }
});

// F1-SPT: panel approval Lost. GET daftar deal loss_status='pending' yg boleh
// diputus user ini (HoD cabangnya / admin semua; AM → kosong).
app.get("/deals/loss-approvals", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json({ pending: await listPendingLosses(await scopeOf(c)) });
});

// Putus loss pending. Body: { decision: "approved"|"rejected", note?: string }.
// approved → tetap Closing-Lost (loss_status=approved). rejected → deal balik ke
// stage sebelum Lost. Guard: hanya HoD/admin (AM ditolak 403).
app.patch("/deals/:id/loss-approval", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const scope = await scopeOf(c);
  const body = await c.req.json().catch(() => ({}));
  const decision = body?.decision === "approved" || body?.decision === "rejected" ? body.decision : "";
  if (!decision) return c.json({ error: "decision wajib (approved/rejected)" }, 400);
  try {
    const res = await decideLoss(c.req.param("id"), decision, scope, typeof body?.note === "string" ? body.note : undefined);
    return c.json(res);
  } catch (e) {
    if (e instanceof DealError) return c.json({ error: e.message }, e.status as 400 | 403 | 404 | 409);
    throw e;
  }
});

// F1-SPT: riwayat perpindahan stage + approval Lost satu deal (spt_state_log).
app.get("/deals/:id/timeline", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  try {
    const entries = await getDealTimeline(c.req.param("id"), await scopeOf(c));
    return c.json({ entries });
  } catch (e) {
    if (e instanceof DealError) return c.json({ error: e.message }, e.status as 403 | 404);
    throw e;
  }
});

// F1-SPT: CRUD deal. POST buat deal baru (stage awal Prospecting), PATCH edit field
// (whitelist, write-guard), DELETE hapus (admin only, + spt_state_log).
app.post("/deals", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const body = await c.req.json().catch(() => ({}));
  try {
    return c.json(await createDeal(await scopeOf(c), body ?? {}), 201);
  } catch (e) {
    if (e instanceof DealError) return c.json({ error: e.message }, e.status as 400 | 403);
    throw e;
  }
});

app.patch("/deals/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const body = await c.req.json().catch(() => ({}));
  try {
    return c.json(await updateDeal(c.req.param("id"), await scopeOf(c), body ?? {}));
  } catch (e) {
    if (e instanceof DealError) return c.json({ error: e.message }, e.status as 400 | 403 | 404);
    throw e;
  }
});

app.delete("/deals/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  try {
    return c.json(await deleteDeal(c.req.param("id"), await scopeOf(c)));
  } catch (e) {
    if (e instanceof DealError) return c.json({ error: e.message }, e.status as 403 | 404);
    throw e;
  }
});

// ── HITL gate (D6): antrian konfirmasi untuk match ambiguous ──
app.get("/hitl", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const status = c.req.query("status") ?? "pending";
  const rows = await listHitl(status);
  return c.json({ status, count: rows.length, items: rows });
});

app.post("/hitl/resolve", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: {
    id?: string;
    decision?: "approve" | "reject";
    chosen_deal_id?: string;
    approver_id?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.id || (body.decision !== "approve" && body.decision !== "reject")) {
    return c.json({ error: "id + decision (approve|reject) wajib" }, 400);
  }
  const r = await resolveHitl(body.id, {
    decision: body.decision,
    chosen_deal_id: body.chosen_deal_id,
    approver_id: body.approver_id,
  });
  return c.json(r, r.ok ? 200 : 400);
});

const port = Number(process.env.PORT ?? 4000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`wrg-api listening on http://localhost:${info.port}`);
  startScheduler();
});
