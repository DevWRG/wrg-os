"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { AlertTriangle, Banknote, Clock, FileCheck2 } from "lucide-react";

import { StatCard } from "@/components/dashboard/stat-card";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { EmptyState } from "@/components/ui/empty-state";
import { ExportButton } from "@/components/ui/export-button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

// F10 Register Cek — bentuk data = daftarCek() di apps/api/src/repo/cek-keluar.ts.
type Status = "draft" | "diajukan" | "disetujui" | "ditolak" | "diserahkan" | "cair" | "tolak_bank" | "batal";
type Aksi = "ajukan" | "setujui" | "tolak" | "serahkan" | "cair" | "tolak_bank" | "batal";
interface Rekening { bank_account_id: string; label: string; saldo: number | null; saldo_tanggal: string | null; saldo_terverifikasi: boolean; beredar: number; beredar_cek: number }
interface Log { dari: string | null; ke: string; oleh: string; catatan: string | null; at: string }
interface Cek {
  id: number; bank_account_id: string; rekening: string; no_seri: string; jenis: "cek" | "giro"; tanggal_terbit: string; jatuh_tempo: string;
  penerima: string; nominal: number; keperluan: string; dokumen_dasar: string | null; status: Status; dibuat_oleh: string; dibuat_at: string;
  diputus_oleh: string | null; diputus_at: string | null; cair_otomatis: boolean; seri_loncat: string | null; peringatan_saldo: string | null; log: Log[];
}
interface Daftar { rekening: Rekening[]; items: Cek[] }

const rp = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const tgl = (s: string) => new Date(`${s}T00:00:00+07:00`).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric" });
const waktu = (s: string) => new Date(s).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const hariIni = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

const STATUS: Record<Status, { t: string; c: string }> = {
  draft: { t: "Draft", c: "bg-slate-500/15 text-slate-700 dark:text-slate-300" },
  diajukan: { t: "Menunggu persetujuan", c: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  disetujui: { t: "Disetujui", c: "bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  ditolak: { t: "Ditolak", c: "bg-red-500/10 text-red-700 dark:text-red-400" },
  diserahkan: { t: "Diserahkan", c: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400" },
  cair: { t: "Cair", c: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  tolak_bank: { t: "Ditolak bank", c: "bg-red-500/10 text-red-700 dark:text-red-400" },
  batal: { t: "Batal", c: "bg-slate-500/15 text-slate-700 dark:text-slate-300" },
};
const LABEL_AKSI: Record<Aksi, string> = {
  ajukan: "Ajukan", setujui: "Setujui", tolak: "Tolak", serahkan: "Tandai diserahkan", cair: "Tandai cair", tolak_bank: "Ditolak bank", batal: "Batalkan",
};
const AKSI_DARI: Record<Status, Aksi[]> = {
  draft: ["ajukan", "batal"], diajukan: ["setujui", "tolak", "batal"], disetujui: ["serahkan", "batal"], diserahkan: ["cair", "tolak_bank"],
  ditolak: [], cair: [], tolak_bank: [], batal: [],
};
const BUTUH_ALASAN: Aksi[] = ["tolak", "tolak_bank", "batal"];

async function kirim<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String((data as { error?: string }).error ?? `gagal (HTTP ${res.status})`));
  return data as T;
}

export function RegisterCekView({ bolehInput, bolehSetujui, saya }: { bolehInput: boolean; bolehSetujui: boolean; saya: string }) {
  const [tab, setTab] = useState<"aktif" | "semua">("aktif");
  const [d, setD] = useState<Daftar | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<Cek | "baru" | null>(null);
  const [buka, setBuka] = useState<number | null>(null);
  const [pratinjau, setPratinjau] = useState<string | null>(null);

  const muat = useCallback(() => {
    kirim<Daftar>(`/api/register-cek?${tab === "aktif" ? "status=aktif" : "hari=365"}`).then((x) => { setD(x); setErr(null); }).catch((e: Error) => setErr(e.message));
  }, [tab]);
  useEffect(() => { muat(); }, [muat]);

  const menunggu = d?.items.filter((x) => x.status === "diajukan") ?? [];
  const beredar = d?.items.filter((x) => x.status === "disetujui" || x.status === "diserahkan") ?? [];
  const jatuhTempo3 = beredar.filter((x) => x.status === "diserahkan" && x.jatuh_tempo <= new Date(Date.parse(`${hariIni()}T00:00:00Z`) + 3 * 86400000).toISOString().slice(0, 10));
  const rekeningMinus = d?.rekening.filter((r) => r.saldo != null && r.beredar > r.saldo) ?? [];

  return (
    <section className="space-y-4">
      {err && <p className="text-destructive text-sm">{err}</p>}
      {d && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Menunggu persetujuan" value={menunggu.length.toLocaleString("id-ID")} delta={menunggu.length ? rp(menunggu.reduce((s, x) => s + x.nominal, 0)) : undefined} icon={Clock} />
          <StatCard title="Cek beredar (belum cair)" value={rp(beredar.reduce((s, x) => s + x.nominal, 0))} delta={`${beredar.length} lembar`} icon={Banknote} />
          <StatCard title="Jatuh tempo ≤ 3 hari" value={jatuhTempo3.length.toLocaleString("id-ID")} deltaTone={jatuhTempo3.length ? "negative" : "neutral"} icon={FileCheck2} />
          <StatCard title="Rekening beredar > saldo" value={rekeningMinus.length.toLocaleString("id-ID")} deltaTone={rekeningMinus.length ? "negative" : "neutral"}
            delta={rekeningMinus.length ? rekeningMinus.map((r) => r.label.split(" · ")[0]).join(", ") : undefined} icon={AlertTriangle} />
        </div>
      )}

      {d && (
        <div className="bg-card overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left">
              <th className="p-2">Rekening</th><th className="p-2 text-right">Saldo rekening koran terakhir</th>
              <th className="p-2 text-right">Cek beredar</th><th className="p-2 text-right">Sisa sesudah semua cair</th>
            </tr></thead>
            <tbody>
              {d.rekening.filter((r) => r.saldo != null || r.beredar > 0).map((r) => {
                const sisa = r.saldo == null ? null : r.saldo - r.beredar;
                return (
                  <tr key={r.bank_account_id} className="border-b last:border-0">
                    <td className="p-2">{r.label}</td>
                    <td className="p-2 text-right whitespace-nowrap tabular-nums">
                      {rp(r.saldo)}
                      {r.saldo_tanggal && <div className="text-muted-foreground text-xs">{tgl(r.saldo_tanggal)}{r.saldo_terverifikasi ? "" : " · belum terverifikasi"}</div>}
                    </td>
                    <td className="p-2 text-right tabular-nums">{r.beredar ? `${rp(r.beredar)} (${r.beredar_cek})` : "—"}</td>
                    <td className={cn("p-2 text-right tabular-nums", sisa != null && sisa < 0 && "font-medium text-red-700 dark:text-red-400")}>{rp(sisa)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-muted-foreground border-t px-2 py-1.5 text-xs">Saldo = saldo akhir rekening koran terakhir yang disetor lewat #KORAN (yang berstatus perlu review tidak dipakai). Rekening tanpa rekening koran tidak punya pembanding.</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v as "aktif" | "semua")}>
          <TabsList>
            <TabsTrigger value="aktif">Aktif</TabsTrigger>
            <TabsTrigger value="semua">Semua (12 bulan)</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => {
            kirim<{ payload?: string; pengingat: number }>("/api/register-cek/pratinjau")
              .then((x) => setPratinjau(x.payload ?? "Tidak ada cek diserahkan yang jatuh tempo dalam 3 hari."))
              .catch((e: Error) => setPratinjau(`Gagal memuat pratinjau: ${e.message}`));
          }}>Pratinjau pengingat WA</Button>
          <ExportButton<Cek>
            filename="register-cek"
            fetchData={async () => (await kirim<Daftar>("/api/register-cek?hari=730")).items}
            columns={[
              { header: "ID", value: (x) => `C${x.id}` }, { header: "Rekening", value: (x) => x.rekening }, { header: "Jenis", value: (x) => x.jenis },
              { header: "No. seri", value: (x) => x.no_seri }, { header: "Terbit", value: (x) => x.tanggal_terbit }, { header: "Jatuh tempo", value: (x) => x.jatuh_tempo },
              { header: "Penerima", value: (x) => x.penerima }, { header: "Nominal", value: (x) => x.nominal }, { header: "Keperluan", value: (x) => x.keperluan },
              { header: "Dokumen dasar", value: (x) => x.dokumen_dasar ?? "" }, { header: "Status", value: (x) => STATUS[x.status].t },
              { header: "Dibuat oleh", value: (x) => x.dibuat_oleh }, { header: "Diputus oleh", value: (x) => x.diputus_oleh ?? "" },
            ]}
          />
          {bolehInput && <Button size="sm" onClick={() => setForm("baru")}>+ Cek baru</Button>}
        </div>
      </div>

      {pratinjau !== null && (
        <div className="bg-card space-y-2 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Pratinjau pengingat WA (belum dikirim)</span>
            <Button size="sm" variant="ghost" onClick={() => setPratinjau(null)}>Tutup</Button>
          </div>
          <pre className="text-xs whitespace-pre-wrap">{pratinjau}</pre>
          <p className="text-muted-foreground text-xs">Dikirim otomatis tiap hari kerja 08.30 (sekali per cek untuk H-3 dan hari H) bila saklar register cek dinyalakan admin sistem.</p>
        </div>
      )}

      {form && d && <FormCek awal={form === "baru" ? null : form} rekening={d.rekening} onClose={() => setForm(null)} onTersimpan={() => { setForm(null); muat(); }} />}

      {!d ? <p className="text-muted-foreground text-sm">{err ? "" : "Memuat…"}</p> : d.items.length === 0 ? (
        <EmptyState title="Belum ada cek" description={tab === "aktif" ? "Tidak ada cek yang sedang berjalan." : "Belum ada cek tercatat 12 bulan terakhir."} />
      ) : (
        <div className="bg-card overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left">
              <th className="p-2">Cek</th><th className="p-2">Penerima / keperluan</th><th className="p-2 text-right">Nominal</th>
              <th className="p-2">Jatuh tempo</th><th className="p-2">Status</th><th className="p-2" />
            </tr></thead>
            <tbody>
              {d.items.map((x) => (
                <Fragment key={x.id}>
                  <tr className="border-b align-top last:border-0">
                    <td className="p-2">
                      <div className="font-mono text-xs">{x.no_seri}</div>
                      <div className="text-muted-foreground text-xs">C{x.id} · {x.jenis === "giro" ? "Giro" : "Cek"} · {x.rekening}</div>
                      {x.seri_loncat && <div className="text-xs text-amber-700 dark:text-amber-400">Seri loncat — seharusnya {x.seri_loncat}. Cek yang terlewat hilang?</div>}
                    </td>
                    <td className="p-2">
                      <div>{x.penerima}</div>
                      <div className="text-muted-foreground text-xs">{x.keperluan}{x.dokumen_dasar ? ` · ${x.dokumen_dasar}` : ""}</div>
                    </td>
                    <td className="p-2 text-right whitespace-nowrap tabular-nums">{rp(x.nominal)}</td>
                    <td className="p-2 whitespace-nowrap">{tgl(x.jatuh_tempo)}</td>
                    <td className="p-2">
                      <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", STATUS[x.status].c)}>{STATUS[x.status].t}</span>
                      {x.cair_otomatis && <div className="text-muted-foreground mt-0.5 text-xs">dari rekening koran</div>}
                      {x.peringatan_saldo && <div className="mt-1 text-xs font-medium text-red-700 dark:text-red-400">⚠ {x.peringatan_saldo}</div>}
                    </td>
                    <td className="p-2">
                      <AksiCek cek={x} bolehInput={bolehInput} bolehSetujui={bolehSetujui} saya={saya} onEdit={() => setForm(x)} onSelesai={muat} />
                      <button type="button" className="text-muted-foreground mt-1 text-xs underline" onClick={() => setBuka(buka === x.id ? null : x.id)}>
                        {buka === x.id ? "Sembunyikan riwayat" : "Riwayat"}
                      </button>
                    </td>
                  </tr>
                  {buka === x.id && (
                    <tr className="border-b bg-muted/40">
                      <td colSpan={6} className="p-2">
                        <ol className="space-y-0.5 text-xs">
                          {x.log.map((l, i) => (
                            <li key={i}>{waktu(l.at)} · <b>{STATUS[l.ke as Status]?.t ?? l.ke}</b>{l.dari === l.ke ? " (data diubah)" : ""} · {l.oleh}{l.catatan ? ` — ${l.catatan}` : ""}</li>
                          ))}
                        </ol>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AksiCek({ cek, bolehInput, bolehSetujui, saya, onEdit, onSelesai }: {
  cek: Cek; bolehInput: boolean; bolehSetujui: boolean; saya: string; onEdit: () => void; onSelesai: () => void;
}) {
  const [alasanUntuk, setAlasanUntuk] = useState<Aksi | null>(null);
  const [alasan, setAlasan] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const milikSendiri = cek.dibuat_oleh.trim().toLowerCase() === saya.trim().toLowerCase();
  const aksi = AKSI_DARI[cek.status].filter((a) =>
    a === "setujui" || a === "tolak" ? bolehSetujui && !milikSendiri : bolehInput);

  const jalankan = (a: Aksi, catatan?: string) => {
    setSibuk(true); setErr(null);
    kirim(`/api/register-cek/${cek.id}/aksi`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ aksi: a, catatan }) })
      .then(() => { setAlasanUntuk(null); setAlasan(""); onSelesai(); })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setSibuk(false));
  };

  if (alasanUntuk) {
    return (
      <div className="flex min-w-56 flex-col gap-1">
        <Input className="h-8" placeholder={`Alasan ${LABEL_AKSI[alasanUntuk].toLowerCase()} (wajib)…`} value={alasan} maxLength={500} onChange={(e) => setAlasan(e.target.value)} />
        <div className="flex gap-1">
          <Button size="sm" variant="destructive" disabled={sibuk || !alasan.trim()} onClick={() => jalankan(alasanUntuk, alasan.trim())}>{LABEL_AKSI[alasanUntuk]}</Button>
          <Button size="sm" variant="ghost" onClick={() => setAlasanUntuk(null)}>Batal</Button>
        </div>
        {err && <span className="text-destructive text-xs">{err}</span>}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {cek.status === "draft" && bolehInput && <Button size="sm" variant="outline" onClick={onEdit}>Ubah</Button>}
      {aksi.map((a) => (
        <Button key={a} size="sm" disabled={sibuk}
          variant={a === "setujui" || a === "ajukan" ? "default" : BUTUH_ALASAN.includes(a) ? "outline" : "secondary"}
          onClick={() => (BUTUH_ALASAN.includes(a) ? setAlasanUntuk(a) : jalankan(a))}>
          {LABEL_AKSI[a]}
        </Button>
      ))}
      {cek.status === "diajukan" && bolehSetujui && milikSendiri && <span className="text-muted-foreground text-xs">Cek buatan Anda — disetujui orang lain.</span>}
      {err && <span className="text-destructive w-full text-xs">{err}</span>}
    </div>
  );
}

function FormCek({ awal, rekening, onClose, onTersimpan }: { awal: Cek | null; rekening: Rekening[]; onClose: () => void; onTersimpan: () => void }) {
  const [v, setV] = useState({
    bank_account_id: awal?.bank_account_id ?? "", no_seri: awal?.no_seri ?? "", jenis: awal?.jenis ?? "cek",
    tanggal_terbit: awal?.tanggal_terbit ?? hariIni(), jatuh_tempo: awal?.jatuh_tempo ?? hariIni(),
    penerima: awal?.penerima ?? "", nominal: awal ? String(awal.nominal) : "", keperluan: awal?.keperluan ?? "", dokumen_dasar: awal?.dokumen_dasar ?? "",
  });
  const [sibuk, setSibuk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const rek = rekening.find((r) => r.bank_account_id === v.bank_account_id);
  const nominal = Number(v.nominal.replace(/[^\d,]/g, "").replace(",", ".")) || 0;
  const sisa = rek?.saldo != null ? rek.saldo - rek.beredar - nominal : null;

  const simpan = (ajukan: boolean) => {
    setSibuk(true); setErr(null);
    const body = JSON.stringify({ ...v, jatuh_tempo: v.jenis === "cek" ? v.tanggal_terbit : v.jatuh_tempo, ajukan: awal ? undefined : ajukan });
    const req = awal
      ? kirim(`/api/register-cek/${awal.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body })
          .then(() => (ajukan ? kirim(`/api/register-cek/${awal.id}/aksi`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ aksi: "ajukan" }) }) : null))
      : kirim("/api/register-cek", { method: "POST", headers: { "content-type": "application/json" }, body });
    req.then(() => onTersimpan()).catch((e: Error) => { setErr(e.message); setSibuk(false); });
  };

  return (
    <div className="bg-card space-y-3 rounded-lg border p-3">
      <div className="text-sm font-medium">{awal ? `Ubah draft C${awal.id}` : "Cek / giro baru"}</div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <label className="space-y-1 text-xs">Rekening
          <Combobox size="sm" value={v.bank_account_id} onChange={(x) => setV({ ...v, bank_account_id: x })} placeholder="Pilih rekening"
            options={rekening.map((r) => ({ value: r.bank_account_id, label: r.label }))} />
        </label>
        <label className="space-y-1 text-xs">Jenis
          <div className="flex gap-1">
            {(["cek", "giro"] as const).map((j) => (
              <Button key={j} type="button" size="sm" variant={v.jenis === j ? "default" : "outline"} onClick={() => setV({ ...v, jenis: j })}>{j === "cek" ? "Cek" : "Bilyet giro"}</Button>
            ))}
          </div>
        </label>
        <label className="space-y-1 text-xs">Nomor seri<Input value={v.no_seri} onChange={set("no_seri")} placeholder="mis. AB 123456" maxLength={40} /></label>
        <label className="space-y-1 text-xs">Tanggal terbit<Input type="date" value={v.tanggal_terbit} onChange={set("tanggal_terbit")} /></label>
        {v.jenis === "giro" && <label className="space-y-1 text-xs">Tanggal efektif / jatuh tempo<Input type="date" value={v.jatuh_tempo} onChange={set("jatuh_tempo")} /></label>}
        <label className="space-y-1 text-xs">Nominal (Rp)<Input inputMode="numeric" value={v.nominal} onChange={set("nominal")} placeholder="45.000.000" /></label>
        <label className="space-y-1 text-xs">Penerima<Input value={v.penerima} onChange={set("penerima")} maxLength={200} /></label>
        <label className="space-y-1 text-xs">Keperluan<Input value={v.keperluan} onChange={set("keperluan")} maxLength={500} /></label>
        <label className="space-y-1 text-xs">Dokumen dasar (opsional)<Input value={v.dokumen_dasar} onChange={set("dokumen_dasar")} placeholder="no. PO / faktur pembelian" maxLength={200} /></label>
      </div>
      {rek && (
        <p className={cn("text-xs", sisa != null && sisa < 0 ? "font-medium text-red-700 dark:text-red-400" : "text-muted-foreground")}>
          {rek.saldo == null
            ? "Rekening ini belum punya rekening koran — tidak ada saldo pembanding."
            : `Saldo ${rp(rek.saldo)} (${tgl(rek.saldo_tanggal ?? "")}) − cek beredar ${rp(rek.beredar)} − cek ini ${rp(nominal)} = ${rp(sisa)}${sisa != null && sisa < 0 ? " — MELEBIHI SALDO" : ""}`}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={sibuk} onClick={() => simpan(true)}>{awal ? "Simpan & ajukan" : "Simpan & ajukan ke HoD"}</Button>
        <Button size="sm" variant="outline" disabled={sibuk} onClick={() => simpan(false)}>Simpan draft</Button>
        <Button size="sm" variant="ghost" disabled={sibuk} onClick={onClose}>Batal</Button>
      </div>
      {err && <p className="text-destructive text-sm">{err}</p>}
    </div>
  );
}
