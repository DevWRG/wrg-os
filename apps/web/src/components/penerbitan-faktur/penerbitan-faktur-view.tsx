"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlarmClock, FileClock, Users, Timer } from "lucide-react";

import { StatCard } from "@/components/dashboard/stat-card";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FakturRevisiTab } from "@/components/penerbitan-faktur/faktur-revisi-tab";
import { cn } from "@/lib/utils";

// F10 Penerbitan Faktur — bentuk data = statusFakturis() di apps/api/src/repo/fakturis-diam.ts.
interface Akun { created_by: string; label: string | null; faktur_60h: number; faktur_7h: number; terakhir_at: string | null }
interface Kejadian { id: number; sejak_at: string; pulih_at: string | null; menit: number; faktur_terakhir: string | null; pulih_faktur: string | null; alarm_terkirim: boolean }
interface Status {
  ambang_jam: number;
  jam_kerja: { mulai: number; selesai: number };
  status: "normal" | "diam";
  menit_diam: number;
  terakhir: { nomor: string; akun: string | null; label: string | null; at: string } | null;
  kejadian: Kejadian[];
  akun: Akun[];
}

const waktu = (s: string) =>
  new Date(s).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const durasi = (m: number) => {
  const j = Math.floor(m / 60);
  const r = m % 60;
  return j && r ? `${j} jam ${r} mnt` : j ? `${j} jam` : `${r} mnt`;
};
const namaAkun = (label: string | null, id: string | null) => label ?? (id ? `Akun Accurate ${id}` : "—");

async function kirim<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String((data as { error?: string }).error ?? `gagal (HTTP ${res.status})`));
  return data as T;
}

export function PenerbitanFakturView({ bolehUbah }: { bolehUbah: boolean }) {
  const [tab, setTab] = useState<"fakturis" | "revisi">("fakturis");
  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as "fakturis" | "revisi")}>
        <TabsList>
          <TabsTrigger value="fakturis">Fakturis</TabsTrigger>
          <TabsTrigger value="revisi">Faktur Revisi</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === "fakturis" ? <FakturisTab bolehUbah={bolehUbah} /> : <FakturRevisiTab bolehUbah={bolehUbah} />}
    </div>
  );
}

function FakturisTab({ bolehUbah }: { bolehUbah: boolean }) {
  const [d, setD] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pratinjau, setPratinjau] = useState<string | null>(null);
  const [karyawan, setKaryawan] = useState<string[]>([]);

  const muat = useCallback(() => {
    kirim<Status>("/api/penerbitan-faktur").then((x) => { setD(x); setErr(null); }).catch((e: Error) => setErr(e.message));
  }, []);
  useEffect(() => { muat(); }, [muat]);
  // Nama fakturis dipilih dari daftar karyawan (Karyawan 360), bukan diketik bebas —
  // supaya ejaan di pesan WA sama dengan master karyawan.
  useEffect(() => {
    if (!bolehUbah) return;
    kirim<{ employees: { nama: string }[] }>("/api/employee-spine/employees")
      .then((x) => setKaryawan([...new Set(x.employees.map((e) => e.nama.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "id"))))
      .catch(() => setKaryawan([]));
  }, [bolehUbah]);

  const total60 = d?.akun.reduce((s, a) => s + a.faktur_60h, 0) ?? 0;
  const teratas = d?.akun[0];
  const porsi = teratas && total60 ? Math.round((teratas.faktur_60h / total60) * 100) : 0;
  const aktif = d?.akun.filter((a) => a.faktur_60h > 0).length ?? 0;

  return (
    <section className="space-y-4">
      {err && <p className="text-destructive text-sm">{err}</p>}
      {!d ? <p className="text-muted-foreground text-sm">{err ? "" : "Memuat…"}</p> : (
        <>
          <div className={cn("flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm",
            d.status === "diam"
              ? "border-red-500/40 bg-red-500/10 text-red-900 dark:text-red-200"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200")}>
            <span>
              {d.status === "diam"
                ? <><b>Faktur berhenti terbit</b> — {durasi(d.menit_diam)} jam kerja tanpa faktur baru.</>
                : <><b>Normal.</b> Faktur masih terbit.</>}
              {" "}Alarm ke grup Finance kalau {d.ambang_jam} jam kerja ({String(d.jam_kerja.mulai).padStart(2, "0")}.00–{d.jam_kerja.selesai}.00, hari kerja) tanpa faktur baru. Data dari Accurate disalin tiap ±2 jam.
            </span>
            {bolehUbah && (
              <Button size="sm" variant="outline" onClick={() => {
                kirim<{ cek: { aksi: string; payload?: string }; rekap: { payload?: string; skipped?: string } }>("/api/penerbitan-faktur/pratinjau")
                  .then((x) => setPratinjau([
                    "— Alarm saat ini —",
                    x.cek.payload ?? `Tidak ada alarm (status: ${x.cek.aksi}).`,
                    "",
                    "— Rekap mingguan —",
                    x.rekap.payload ?? `Tidak ada: ${x.rekap.skipped ?? "—"}`,
                  ].join("\n")))
                  .catch((e: Error) => setPratinjau(`Gagal memuat pratinjau: ${e.message}`));
              }}>Pratinjau pesan WA</Button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard title="Faktur terakhir" value={d.terakhir ? waktu(d.terakhir.at) : "—"}
              delta={d.terakhir ? `${d.terakhir.nomor} · ${namaAkun(d.terakhir.label, d.terakhir.akun)}` : undefined} icon={FileClock} />
            <StatCard title="Kejadian diam (30 hari)" value={d.kejadian.length.toLocaleString("id-ID")}
              deltaTone={d.kejadian.length ? "negative" : "neutral"} icon={AlarmClock} />
            <StatCard title="Akun pembuat faktur (60 hari)" value={aktif.toLocaleString("id-ID")}
              deltaTone={aktif <= 2 ? "negative" : "neutral"} delta={aktif <= 2 ? "Tanpa cadangan bila satu berhalangan" : undefined} icon={Users} />
            <StatCard title="Porsi akun terbesar" value={total60 ? `${porsi}%` : "—"}
              delta={teratas && total60 ? namaAkun(teratas.label, teratas.created_by) : undefined} deltaTone={porsi >= 70 ? "negative" : "neutral"} icon={Timer} />
          </div>

          <div className="space-y-2">
            <h2 className="text-sm font-semibold">Akun fakturis</h2>
            <p className="text-muted-foreground text-xs">Akun Accurate yang membuat faktur. Beri nama supaya pesan WA menyebut orangnya, bukan nomor akun.</p>
            {d.akun.length === 0 ? <EmptyState title="Belum ada faktur 60 hari terakhir" description="Cek sinkron Accurate." /> : (
              <div className="bg-card overflow-x-auto rounded-lg border sm:overflow-visible">
                <table className="w-full text-sm">
                  <thead><tr className="border-b text-left">
                    <th className="p-2">Akun Accurate</th><th className="p-2">Nama</th>
                    <th className="p-2 text-right">Faktur 7 hari</th><th className="p-2 text-right">Faktur 60 hari</th><th className="p-2">Terakhir</th>
                  </tr></thead>
                  <tbody>
                    {d.akun.map((a) => (
                      <tr key={a.created_by} className="border-b last:border-0">
                        <td className="p-2 font-mono text-xs">{a.created_by}</td>
                        <td className="p-2">{bolehUbah ? <LabelAkun akun={a} karyawan={karyawan} onTersimpan={muat} /> : (a.label ?? <span className="text-muted-foreground">—</span>)}</td>
                        <td className="p-2 text-right tabular-nums">{a.faktur_7h.toLocaleString("id-ID")}</td>
                        <td className="p-2 text-right tabular-nums">
                          {a.faktur_60h.toLocaleString("id-ID")}
                          {total60 > 0 && <span className="text-muted-foreground ml-1 text-xs">({Math.round((a.faktur_60h / total60) * 100)}%)</span>}
                        </td>
                        <td className="p-2 whitespace-nowrap">{a.terakhir_at ? waktu(a.terakhir_at) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <h2 className="text-sm font-semibold">Riwayat faktur berhenti terbit (30 hari)</h2>
            {d.kejadian.length === 0 ? <EmptyState title="Tidak ada kejadian" description="Faktur terbit normal selama 30 hari terakhir." /> : (
              <div className="bg-card overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead><tr className="border-b text-left">
                    <th className="p-2">Diam sejak</th><th className="p-2">Terbit lagi</th><th className="p-2 text-right">Lama (jam kerja)</th>
                    <th className="p-2">Faktur sebelum / sesudah</th><th className="p-2">Alarm WA</th>
                  </tr></thead>
                  <tbody>
                    {d.kejadian.map((k) => (
                      <tr key={k.id} className="border-b last:border-0">
                        <td className="p-2 whitespace-nowrap">{waktu(k.sejak_at)}</td>
                        <td className="p-2 whitespace-nowrap">{k.pulih_at ? waktu(k.pulih_at) : <span className="font-medium text-red-700 dark:text-red-400">masih diam</span>}</td>
                        <td className="p-2 text-right tabular-nums">{durasi(k.menit)}</td>
                        <td className="p-2 font-mono text-xs">{k.faktur_terakhir ?? "—"} → {k.pulih_faktur ?? "—"}</td>
                        <td className="p-2 text-xs">{k.alarm_terkirim ? "terkirim" : <span className="text-amber-700 dark:text-amber-400">belum terkirim</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {pratinjau !== null && (
        <div className="bg-card space-y-2 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Pratinjau pesan WA (belum dikirim)</span>
            <Button size="sm" variant="ghost" onClick={() => setPratinjau(null)}>Tutup</Button>
          </div>
          <pre className="text-xs whitespace-pre-wrap">{pratinjau}</pre>
          <p className="text-muted-foreground text-xs">Dikirim otomatis ke grup Finance hanya bila saklar alarm dinyalakan admin sistem. Rekap mingguan terkirim sekali seminggu, hari kerja pertama pukul 08.15.</p>
        </div>
      )}
    </section>
  );
}

function LabelAkun({ akun, karyawan, onTersimpan }: { akun: Akun; karyawan: string[]; onTersimpan: () => void }) {
  const [sibuk, setSibuk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Label lama yang tak ada di master karyawan tetap tampil sebagai opsi, supaya tidak hilang diam-diam.
  const opsi = useMemo<ComboboxOption[]>(() => {
    const nama = akun.label && !karyawan.includes(akun.label) ? [akun.label, ...karyawan] : karyawan;
    return nama.map((n) => ({ value: n, label: n }));
  }, [akun.label, karyawan]);
  return (
    <div className="flex items-center gap-2">
      <Combobox value={akun.label ?? ""} options={opsi} disabled={sibuk} triggerClassName="h-8 w-56"
        placeholder="Pilih nama fakturis…" searchPlaceholder="Cari nama karyawan…"
        onChange={(v) => {
          if (!v || v === akun.label) return;
          setSibuk(true);
          kirim("/api/penerbitan-faktur/akun", {
            method: "PUT", headers: { "content-type": "application/json" },
            body: JSON.stringify({ created_by: akun.created_by, label: v }),
          }).then(() => { setErr(null); onTersimpan(); }).catch((e: Error) => setErr(e.message)).finally(() => setSibuk(false));
        }} />
      {sibuk && <span className="text-muted-foreground text-xs">Menyimpan…</span>}
      {err && <span className="text-destructive text-xs">{err}</span>}
    </div>
  );
}
