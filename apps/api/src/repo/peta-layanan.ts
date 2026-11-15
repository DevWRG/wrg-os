// Peta layanan untuk /status-job: status proses server (pm2 + launchd) dan ringkasan job per
// kelompok. Hanya MEMBACA — `pm2 jlist` dan `launchctl list`, tanpa argumen dari pengguna.
//
// WA Bridge & gateway OpenClaw jalan lewat launchd, BUKAN pm2 — tanpa sumber launchd keduanya
// akan terlihat "hilang". Di mesin tanpa pm2/launchctl (laptop dev, CI) sumbernya dilaporkan
// tidak tersedia, bukan galat.
import { execFile } from "node:child_process";

import type { BarisStatusJob } from "./job-run.js";

export type StatusLayanan = "OK" | "PERINGATAN" | "MATI";

export interface AnggotaLayanan {
  nama: string;
  label: string;
  sumber: "pm2" | "launchd";
  status: StatusLayanan;
  keadaan: string;
  pid: number | null;
  mulai: string | null;
  restart: number | null;
  mem_mb: number | null;
  cpu: number | null;
  exit: number | null;
}

export interface KelompokLayanan {
  kunci: string;
  judul: string;
  status: StatusLayanan;
  anggota: AnggotaLayanan[];
}

export interface KelompokJob {
  kunci: string;
  judul: string;
  status: StatusLayanan;
  total: number;
  ok: number;
  gagal: number;
  terlewat: number;
  belum_jalan: number;
  nonaktif: number;
  bermasalah: string[];
}

export interface PetaLayanan {
  sekarang: string;
  sumber: { pm2: boolean; launchd: boolean };
  layanan: KelompokLayanan[];
  job: KelompokJob[];
}

interface ProsesMentah {
  nama: string;
  sumber: "pm2" | "launchd";
  keadaan: string;
  pid: number | null;
  mulai: string | null;
  restart: number | null;
  mem_mb: number | null;
  cpu: number | null;
  exit: number | null;
}

// ── Parser ──────────────────────────────────────────────────────────────────────────────

/** `pm2 jlist` memuat seluruh env proses (termasuk rahasia) — hanya kolom status yang diambil. */
export function uraiPm2(json: string): ProsesMentah[] {
  const data: unknown = JSON.parse(json);
  if (!Array.isArray(data)) return [];
  type Pm2Mentah = {
    name?: unknown;
    pid?: unknown;
    monit?: { memory?: unknown; cpu?: unknown };
    pm2_env?: { status?: unknown; pm_uptime?: unknown; restart_time?: unknown };
  };
  const angka = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return (data as Pm2Mentah[]).map((p) => {
    const env = p.pm2_env ?? {};
    const keadaan = String(env.status ?? "unknown");
    const pid = angka(p.pid);
    const uptime = angka(env.pm_uptime);
    const mem = angka(p.monit?.memory);
    return {
      nama: String(p.name ?? "?"),
      sumber: "pm2" as const,
      keadaan,
      pid: pid !== null && pid > 0 ? pid : null,
      mulai: keadaan === "online" && uptime !== null ? new Date(uptime).toISOString() : null,
      restart: angka(env.restart_time),
      mem_mb: mem !== null ? Math.round(mem / 1048576) : null,
      cpu: angka(p.monit?.cpu),
      exit: null,
    };
  });
}

/** Label launchd milik WRG-OS & OpenClaw saja; layanan macOS lain diabaikan. */
const LABEL_LAUNCHD = /^(com\.wrg\.|ai\.wrg|ai\.openclaw)/;

/** Layanan menetap wajib punya PID; sisanya job berkala yang cukup keluar dengan kode 0. */
const LAUNCHD_MENETAP = new Set(["com.wrg.wabridge", "ai.openclaw.gateway", "ai.wrg-crm.dashboard", "ai.wrg-crm.dashboard-dev"]);

export function uraiLaunchd(teks: string): ProsesMentah[] {
  const hasil: ProsesMentah[] = [];
  for (const baris of teks.split("\n")) {
    const kolom = baris.trim().split(/\s+/);
    if (kolom.length !== 3 || !LABEL_LAUNCHD.test(kolom[2])) continue;
    const [pid, kode, label] = kolom;
    const jalan = /^\d+$/.test(pid);
    const exit = /^-?\d+$/.test(kode) ? Number(kode) : null;
    hasil.push({
      nama: label,
      sumber: "launchd",
      keadaan: jalan ? "online" : LAUNCHD_MENETAP.has(label) ? "stopped" : exit === 0 ? "berkala" : `exit ${kode}`,
      pid: jalan ? Number(pid) : null,
      mulai: null,
      restart: null,
      mem_mb: null,
      cpu: null,
      exit,
    });
  }
  return hasil;
}

// ── Pengelompokan ───────────────────────────────────────────────────────────────────────

interface DefKelompok {
  kunci: string;
  judul: string;
  /** Anggota bernama yang WAJIB ada; hilang = MATI. */
  wajib?: { nama: string; label: string }[];
  cocok: (p: ProsesMentah) => boolean;
}

const KELOMPOK: DefKelompok[] = [
  {
    kunci: "inti",
    judul: "Inti Prod",
    wajib: [
      { nama: "wrg-prod-api", label: "API" },
      { nama: "wrg-prod-web", label: "Web" },
      { nama: "wrg-prod-ai", label: "AI" },
    ],
    cocok: () => false,
  },
  {
    kunci: "wa",
    judul: "WhatsApp",
    wajib: [
      { nama: "com.wrg.wabridge", label: "WA Bridge" },
      { nama: "ai.openclaw.gateway", label: "OpenClaw" },
    ],
    cocok: () => false,
  },
  {
    kunci: "edge",
    judul: "Akses & Deploy",
    wajib: [
      { nama: "wrg-prod-cftunnel", label: "Tunnel Cloudflare" },
      { nama: "wrg-prod-deployhook", label: "Deploy hook" },
      { nama: "com.wrg.autodeploy", label: "Auto-deploy" },
    ],
    cocok: () => false,
  },
  { kunci: "watchdog", judul: "Watchdog & Backup", cocok: (p) => p.sumber === "launchd" && p.nama.startsWith("com.wrg.") },
  { kunci: "dev", judul: "Tumpukan Dev", cocok: (p) => p.nama.startsWith("wrg-dev-") },
  { kunci: "demo", judul: "Tumpukan Demo", cocok: (p) => p.nama.startsWith("wrg-demo-") },
  { kunci: "lain", judul: "Proses Lain", cocok: () => true },
];

const BOBOT: Record<StatusLayanan, number> = { MATI: 2, PERINGATAN: 1, OK: 0 };
const terburuk = (s: StatusLayanan[]): StatusLayanan => s.reduce<StatusLayanan>((a, b) => (BOBOT[b] > BOBOT[a] ? b : a), "OK");

export function statusProses(p: ProsesMentah): StatusLayanan {
  if (p.keadaan === "online" || p.keadaan === "berkala") return "OK";
  if (p.keadaan.startsWith("exit ")) return "PERINGATAN";
  return "MATI";
}

const labelBawaan = (nama: string): string =>
  nama.replace(/^wrg-(prod|dev|demo)-/, "").replace(/^com\.wrg\./, "").replace(/^ai\./, "");

export function kelompokkanLayanan(proses: ProsesMentah[], sumber: { pm2: boolean; launchd: boolean }): KelompokLayanan[] {
  const sisa = new Map(proses.map((p) => [`${p.sumber}:${p.nama}`, p]));
  const ambil = (nama: string): ProsesMentah | undefined => {
    for (const [k, p] of sisa) {
      if (p.nama === nama) {
        sisa.delete(k);
        return p;
      }
    }
    return undefined;
  };
  const jadiAnggota = (p: ProsesMentah, label: string): AnggotaLayanan => ({ ...p, label, status: statusProses(p) });

  const hasil: KelompokLayanan[] = [];
  for (const def of KELOMPOK) {
    const anggota: AnggotaLayanan[] = [];
    for (const w of def.wajib ?? []) {
      const p = ambil(w.nama);
      const sumberW = w.nama.includes(".") ? "launchd" : "pm2";
      // Sumber tak terbaca di mesin ini (mis. laptop tanpa launchd) → jangan vonis "hilang".
      if (!p && !sumber[sumberW]) continue;
      anggota.push(
        p
          ? jadiAnggota(p, w.label)
          : { nama: w.nama, label: w.label, sumber: sumberW, status: "MATI", keadaan: "tidak ditemukan", pid: null, mulai: null, restart: null, mem_mb: null, cpu: null, exit: null },
      );
    }
    for (const [k, p] of [...sisa]) {
      if (!def.cocok(p)) continue;
      sisa.delete(k);
      anggota.push(jadiAnggota(p, labelBawaan(p.nama)));
    }
    if (anggota.length) hasil.push({ kunci: def.kunci, judul: def.judul, status: terburuk(anggota.map((a) => a.status)), anggota });
  }
  return hasil;
}

/** Kelompok job dari awalan nama job; yang tak cocok masuk "Monitoring & Brief". */
const KELOMPOK_JOB: { kunci: string; judul: string; cocok: RegExp }[] = [
  { kunci: "accurate", judul: "Sinkron Accurate", cocok: /^(accurate-|stok-gudang|mirror-freshness)/ },
  { kunci: "finance", judul: "Finance", cocok: /^(invoice-|f10-|do-belum|tutup-buku)/ },
  { kunci: "kso", judul: "Komite KSO", cocok: /^kso-/ },
  { kunci: "hr", judul: "HR & Insentif", cocok: /^(detect-leave|npk-|insentif-|raport-)/ },
  { kunci: "sales", judul: "Sales", cocok: /^(sales-|deal-|scc-|daily-summary|reminder-|plan-check|report-check|notif-tua|geo-sweep|A\d+$)/ },
  { kunci: "monitor", judul: "Monitoring & Brief", cocok: /.*/ },
];

export function kelompokkanJob(jobs: BarisStatusJob[]): KelompokJob[] {
  const hasil: KelompokJob[] = [];
  for (const def of KELOMPOK_JOB) {
    const anggota = jobs.filter((j) => KELOMPOK_JOB.find((k) => k.cocok.test(j.job))?.kunci === def.kunci);
    if (!anggota.length) continue;
    const hitung = (s: BarisStatusJob["status"]) => anggota.filter((j) => j.status === s).length;
    const gagal = hitung("GAGAL");
    const terlewat = hitung("TERLEWAT");
    hasil.push({
      kunci: def.kunci,
      judul: def.judul,
      status: gagal ? "MATI" : terlewat ? "PERINGATAN" : "OK",
      total: anggota.length,
      ok: hitung("OK"),
      gagal,
      terlewat,
      belum_jalan: hitung("BELUM_JALAN"),
      nonaktif: hitung("NONAKTIF"),
      bermasalah: anggota.filter((j) => j.status === "GAGAL" || j.status === "TERLEWAT").map((j) => j.job),
    });
  }
  return hasil;
}

// ── Pembaca sistem ──────────────────────────────────────────────────────────────────────

const PATH_EKSTRA = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";

function jalankan(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: 8000, maxBuffer: 64 << 20, env: { ...process.env, PATH: `${process.env.PATH ?? ""}:${PATH_EKSTRA}` } },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

let cache: { waktu: number; proses: ProsesMentah[]; sumber: { pm2: boolean; launchd: boolean } } | null = null;
const CACHE_MS = 15_000;

/** pm2 jlist memanggil daemon pm2 (~ratusan ms) — di-cache 15 detik supaya muat ulang beruntun murah. */
async function bacaProses(): Promise<{ proses: ProsesMentah[]; sumber: { pm2: boolean; launchd: boolean } }> {
  if (cache && Date.now() - cache.waktu < CACHE_MS) return cache;
  const [pm2, launchd] = await Promise.all([
    jalankan(process.env.PM2_BIN ?? "pm2", ["jlist"]).then(uraiPm2).catch(() => null),
    process.platform === "darwin" ? jalankan("/bin/launchctl", ["list"]).then(uraiLaunchd).catch(() => null) : Promise.resolve(null),
  ]);
  cache = { waktu: Date.now(), proses: [...(pm2 ?? []), ...(launchd ?? [])], sumber: { pm2: pm2 !== null, launchd: launchd !== null } };
  return cache;
}

export async function petaLayanan(jobs: BarisStatusJob[]): Promise<PetaLayanan> {
  const { proses, sumber } = await bacaProses();
  return {
    sekarang: new Date().toISOString(),
    sumber,
    layanan: kelompokkanLayanan(proses, sumber),
    job: kelompokkanJob(jobs),
  };
}
