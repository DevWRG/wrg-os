"use client";

import { useCallback, useEffect, useState } from "react";
import { AlarmClock, CheckCircle2, FilePen, Timer } from "lucide-react";

import { StatCard } from "@/components/dashboard/stat-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ExportButton } from "@/components/ui/export-button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// F10 Faktur Revisi — bentuk data = daftarRevisi() di apps/api/src/repo/revisi-faktur.ts.
type Status = "terbuka" | "terlambat" | "tepat" | "lewat-sla" | "tanpa-sla" | "manual";
interface Baris {
  id: number; nomor: string; sumber: "wa" | "deteksi"; customer: string | null; alasan: string | null;
  diminta_oleh: string | null; diminta_at: string | null; batas_sla: string | null; selesai_at: string | null;
  cara_selesai: string | null; ditutup_oleh: string | null; catatan: string | null; menit_proses: number | null; status: Status;
}
interface Daftar {
  hari: number; sla_jam_kerja: number;
  ringkasan: { terbuka: number; terlambat: number; selesai_sla: number; tepat_sla_pct: number | null; median_menit: number | null; tanpa_sla: number };
  items: Baris[];
}

const waktu = (s: string | null) =>
  s ? new Date(s).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
const durasi = (m: number | null) => {
  if (m == null) return "—";
  const j = Math.floor(m / 60);
  const r = m % 60;
  return j && r ? `${j} jam ${r} mnt` : j ? `${j} jam` : `${r} mnt`;
};
const LABEL: Record<Status, { t: string; c: string }> = {
  terbuka: { t: "Terbuka", c: "bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  terlambat: { t: "Lewat SLA", c: "bg-red-500/10 text-red-700 dark:text-red-400" },
  tepat: { t: "Selesai tepat SLA", c: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  "lewat-sla": { t: "Selesai, telat", c: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  "tanpa-sla": { t: "Terdeteksi (tanpa #REVISI)", c: "bg-slate-500/15 text-slate-700 dark:text-slate-300" },
  manual: { t: "Ditutup manual", c: "bg-slate-500/15 text-slate-700 dark:text-slate-300" },
};
const CARA: Record<string, string> = { input_ulang: "dihapus & diinput ulang", edit: "diedit di Accurate", manual: "ditutup manual" };

async function kirim<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String((data as { error?: string }).error ?? `gagal (HTTP ${res.status})`));
  return data as T;
}

export function FakturRevisiTab({ bolehUbah }: { bolehUbah: boolean }) {
  const [d, setD] = useState<Daftar | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<"semua" | "terbuka">("semua");

  const muat = useCallback(() => {
    kirim<Daftar>("/api/penerbitan-faktur/revisi?hari=60").then((x) => { setD(x); setErr(null); }).catch((e: Error) => setErr(e.message));
  }, []);
  useEffect(() => { muat(); }, [muat]);

  const items = (d?.items ?? []).filter((x) => filter === "semua" || x.status === "terbuka" || x.status === "terlambat");
  const r = d?.ringkasan;

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm text-sky-900 dark:text-sky-200">
        Minta revisi lewat WA: <code className="font-mono">#REVISI &lt;nomor faktur&gt; | alasan</code>. Batas SLA {d?.sla_jam_kerja ?? 8} jam kerja.
        Tiket tertutup otomatis saat faktur hasil revisinya muncul di Accurate (diinput ulang atau diedit). Revisi tanpa #REVISI tetap tercatat, tanpa SLA.
      </div>
      {err && <p className="text-destructive text-sm">{err}</p>}
      {r && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Revisi terbuka" value={r.terbuka.toLocaleString("id-ID")} delta={r.terlambat ? `${r.terlambat} lewat SLA` : undefined} deltaTone={r.terlambat ? "negative" : "neutral"} icon={FilePen} />
          <StatCard title="Tepat SLA (60 hari)" value={r.tepat_sla_pct == null ? "—" : `${r.tepat_sla_pct}%`} delta={r.selesai_sla ? `dari ${r.selesai_sla} revisi lewat #REVISI` : undefined} icon={CheckCircle2} />
          <StatCard title="Median lama proses" value={durasi(r.median_menit)} delta="jam kerja" icon={Timer} />
          <StatCard title="Revisi tanpa #REVISI" value={r.tanpa_sla.toLocaleString("id-ID")} delta="terdeteksi dari Accurate" icon={AlarmClock} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={filter === "semua" ? "default" : "outline"} onClick={() => setFilter("semua")}>Semua (60 hari)</Button>
        <Button size="sm" variant={filter === "terbuka" ? "default" : "outline"} onClick={() => setFilter("terbuka")}>Hanya terbuka</Button>
        <div className="ml-auto">
          <ExportButton<Baris>
            filename="faktur-revisi"
            fetchData={async () => (await kirim<Daftar>("/api/penerbitan-faktur/revisi?hari=180")).items}
            columns={[
              { header: "Tiket", value: (x) => `R${x.id}` },
              { header: "No. faktur", value: (x) => x.nomor },
              { header: "Customer", value: (x) => x.customer ?? "" },
              { header: "Sumber", value: (x) => (x.sumber === "wa" ? "#REVISI" : "terdeteksi") },
              { header: "Alasan", value: (x) => x.alasan ?? "" },
              { header: "Diminta oleh", value: (x) => x.diminta_oleh ?? "" },
              { header: "Diminta", value: (x) => x.diminta_at ?? "" },
              { header: "Batas SLA", value: (x) => x.batas_sla ?? "" },
              { header: "Selesai", value: (x) => x.selesai_at ?? "" },
              { header: "Cara selesai", value: (x) => (x.cara_selesai ? CARA[x.cara_selesai] ?? x.cara_selesai : "") },
              { header: "Lama (menit jam kerja)", value: (x) => x.menit_proses ?? "" },
              { header: "Status", value: (x) => LABEL[x.status].t },
              { header: "Catatan", value: (x) => x.catatan ?? "" },
            ]}
          />
        </div>
      </div>
      {!d ? <p className="text-muted-foreground text-sm">{err ? "" : "Memuat…"}</p> : items.length === 0 ? (
        <EmptyState title="Belum ada revisi" description={filter === "terbuka" ? "Tidak ada revisi yang menunggu." : "Tidak ada revisi faktur dalam 60 hari terakhir."} />
      ) : (
        <div className="bg-card overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left">
              <th className="p-2">Faktur</th><th className="p-2">Alasan / peminta</th><th className="p-2">Diminta</th>
              <th className="p-2">Batas SLA</th><th className="p-2">Selesai</th><th className="p-2">Status</th>{bolehUbah && <th className="p-2" />}
            </tr></thead>
            <tbody>
              {items.map((x) => (
                <tr key={x.id} className="border-b align-top last:border-0">
                  <td className="p-2">
                    <div className="font-mono text-xs">{x.nomor}</div>
                    <div className="text-muted-foreground text-xs">R{x.id}{x.customer ? ` · ${x.customer}` : ""}</div>
                  </td>
                  <td className="p-2">
                    <div>{x.alasan ?? <span className="text-muted-foreground">—</span>}</div>
                    {x.diminta_oleh && <div className="text-muted-foreground text-xs">{x.diminta_oleh}</div>}
                    {x.catatan && <div className="text-muted-foreground text-xs">Catatan: {x.catatan}{x.ditutup_oleh ? ` (${x.ditutup_oleh})` : ""}</div>}
                  </td>
                  <td className="p-2 whitespace-nowrap">{waktu(x.diminta_at)}</td>
                  <td className="p-2 whitespace-nowrap">{waktu(x.batas_sla)}</td>
                  <td className="p-2 whitespace-nowrap">
                    {waktu(x.selesai_at)}
                    {x.cara_selesai && <div className="text-muted-foreground text-xs">{CARA[x.cara_selesai] ?? x.cara_selesai}{x.menit_proses != null ? ` · ${durasi(x.menit_proses)}` : ""}</div>}
                  </td>
                  <td className="p-2"><span className={cn("rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", LABEL[x.status].c)}>{LABEL[x.status].t}</span></td>
                  {bolehUbah && (
                    <td className="p-2">{(x.status === "terbuka" || x.status === "terlambat") && <TutupManual id={x.id} onSelesai={muat} />}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TutupManual({ id, onSelesai }: { id: number; onSelesai: () => void }) {
  const [buka, setBuka] = useState(false);
  const [catatan, setCatatan] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!buka) return <Button size="sm" variant="outline" onClick={() => setBuka(true)}>Tutup manual</Button>;
  return (
    <div className="flex min-w-56 flex-col gap-1">
      <Input className="h-8" placeholder="Alasan ditutup (wajib)…" value={catatan} maxLength={500} onChange={(e) => setCatatan(e.target.value)} />
      <div className="flex gap-1">
        <Button size="sm" disabled={sibuk || !catatan.trim()} onClick={() => {
          setSibuk(true);
          kirim(`/api/penerbitan-faktur/revisi/${id}/tutup`, {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ catatan: catatan.trim() }),
          }).then(() => onSelesai()).catch((e: Error) => setErr(e.message)).finally(() => setSibuk(false));
        }}>Simpan</Button>
        <Button size="sm" variant="ghost" onClick={() => setBuka(false)}>Batal</Button>
      </div>
      {err && <span className="text-destructive text-xs">{err}</span>}
    </div>
  );
}
