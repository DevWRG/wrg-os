"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Calculator, FileText, Link2, Paperclip } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { OpsPanel } from "./ops-panel";
import { CariFaskes, type Faskes } from "./tambah-proyek-dialog";
import { bulan, kirim, RAG_KELAS, rp, STATUS_RAG, tgl, type Catatan, type Detail } from "./types";

const TAHAP_NAMA: Record<string, string> = {
  "1": "Deal", "2": "Asistensi PERNEFRI", "3": "DED", "4": "CIP — konstruksi", "5": "Izin OSS",
  "6a": "BPJS approval", "6b": "Layanan Umum", "6c": "Bypass", "7": "Layanan berjalan",
};
const MAKS_BERKAS = 5;

export function ProyekDetail({ id, bolehUbah }: { id: string; bolehUbah: boolean }) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [maju, setMaju] = useState(false);
  const [faskes, setFaskes] = useState(false);

  // Respons yang datang sesudah efek dibersihkan dibuang — kalau tidak, muatan awal yang
  // lambat bisa menimpa detail hasil simpan catatan (diubah_at basi → maju tahap 409).
  useEffect(() => {
    let batal = false;
    kirim<Detail>(`/api/proyek-hd/${encodeURIComponent(id)}`)
      .then((r) => { if (!batal) setD(r); })
      .catch((e) => { if (!batal) setErr((e as Error).message); });
    return () => { batal = true; };
  }, [id]);

  if (err && !d) return <p className="text-destructive text-sm">{err}</p>;
  if (!d) return <p className="text-muted-foreground text-sm">Memuat…</p>;
  const p = d.proyek;
  const kini = d.catatan.filter((c) => c.tahap_kode === p.tahap_kode);
  const selesai = [...new Set(d.catatan.map((c) => c.tahap_kode))].filter((k) => k !== p.tahap_kode);

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-xl font-bold">{p.nama_rs}</h2>
            <p className="text-muted-foreground text-sm">
              {[p.kode, p.tipe_proyek, p.nama_alat, p.nomor_kontrak ? `Kontrak ${p.nomor_kontrak}` : "Kontrak: proses",
                p.pic_nama ? `PIC ${p.pic_nama}` : null].filter(Boolean).join(" · ")}
            </p>
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Faskes WRG-OS:</span>
              {p.faskes_nama ? <strong>{p.faskes_nama}</strong> : <span className="text-amber-700 dark:text-amber-400">belum ditautkan</span>}
              {bolehUbah && (
                <Button size="xs" variant="soft" onClick={() => setFaskes(true)}><Link2 />{p.faskes_nama ? "Ganti" : "Tautkan faskes"}</Button>
              )}
            </p>
            <p className="text-muted-foreground text-sm">
              Prioritas {p.prioritas} · target go-live {bulan(p.target_golive)} · target {p.target_tindakan_bln ?? "—"} tindakan/bln · harga unit {rp(p.harga_unit)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={RAG_KELAS[p.status_rag]}>{p.status_rag}</Badge>
            <Link href={`/proyek-hd/simulator?proyek=${p.id}`} className={buttonVariants({ variant: "soft" })}><Calculator />Simulator HD</Link>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Alur tahap</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
          {d.alur.map((s) => (
            <div key={s.kode} aria-current={s.status === "berjalan" ? "step" : undefined}
              className={cn("flex flex-col gap-1 rounded-lg border-2 p-3",
                s.status === "selesai" && "border-primary/30 bg-primary/10",
                s.status === "berjalan" && "border-primary bg-primary text-primary-foreground",
                s.status === "belum" && "bg-card border-dashed")}>
              <span className="text-xs font-bold opacity-80">{s.kode}{s.status === "selesai" ? " · Selesai" : s.status === "berjalan" ? " · Berjalan" : ""}</span>
              <strong className="text-sm leading-tight">{s.nama}</strong>
              {s.status !== "belum" && <span className="text-xs opacity-80">{d.catatan.filter((c) => c.tahap_kode === s.kode).length} catatan</span>}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>Tahap berjalan · {p.tahap_kode} {p.tahap_nama}</CardTitle>
            {bolehUbah && d.opsi_maju.length > 0 && <Button onClick={() => setMaju(true)}>Tandai tahap selesai</Button>}
          </CardHeader>
          <CardContent className="space-y-4">
            {bolehUbah && <FormCatatan id={p.id} tahapKode={p.tahap_kode} onSaved={setD} />}
            <DaftarCatatan items={kini} kosong="Belum ada catatan di tahap ini." />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Tahap selesai</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {selesai.length === 0 && <p className="text-muted-foreground text-sm">Belum ada catatan tahap sebelumnya.</p>}
            {selesai.map((k) => (
              <div key={k} className="space-y-2">
                <h3 className="text-sm font-semibold">{k} · {TAHAP_NAMA[k] ?? k}</h3>
                <DaftarCatatan items={d.catatan.filter((c) => c.tahap_kode === k)} kosong="" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <OpsPanel proyekId={p.id} pernefri={d.catatan.some((c) => c.tahap_kode === "2")} />

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <StatusUnit d={d} bolehUbah={bolehUbah} onSaved={(np) => setD({ ...d, proyek: np })} />
        <Card>
          <CardHeader><CardTitle>Riwayat tahap</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {d.riwayat.map((h) => (
              <div key={h.id} className="flex flex-wrap gap-x-4 border-b pb-2 last:border-b-0">
                <span className="text-muted-foreground w-24">{tgl(h.tanggal)}</span>
                <strong className="w-32 truncate">{h.oleh ?? "—"}</strong>
                <span>{h.dari_tahap ? `Tahap ${h.dari_tahap} selesai → ${h.ke_tahap}` : `Proyek dibuat di tahap ${h.ke_tahap}`}</span>
              </div>
            ))}
            {p.diubah_oleh && <p className="text-muted-foreground text-xs">Update terakhir {tgl(p.diubah_at)} oleh {p.diubah_oleh}.</p>}
          </CardContent>
        </Card>
      </div>

      {faskes && <FaskesDialog d={d} onClose={() => setFaskes(false)} onSaved={(np) => { setD({ ...d, proyek: np }); setFaskes(false); }} />}
      {maju && <MajuDialog d={d} onClose={() => setMaju(false)} onSaved={(nd) => { setD(nd); setMaju(false); }} />}
    </div>
  );
}

function DaftarCatatan({ items, kosong }: { items: Catatan[]; kosong: string }) {
  if (!items.length) return kosong ? <p className="text-muted-foreground text-sm">{kosong}</p> : null;
  return (
    <div className="space-y-3">
      {items.map((c) => (
        <div key={c.id} className="bg-card space-y-1.5 rounded-md border p-3 text-sm">
          <div className="text-muted-foreground flex flex-wrap gap-x-3 text-xs"><span>{tgl(c.tanggal)}</span><span>{c.oleh ?? "—"}</span></div>
          <p className="whitespace-pre-wrap">{c.catatan}</p>
          {c.lampiran.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {c.lampiran.map((l) => (
                <a key={l.id} href={`/api/proyek-hd/lampiran/${l.id}`} target="_blank" rel="noopener"
                  className="bg-card hover:border-foreground/40 inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium">
                  <FileText className="size-3.5 shrink-0" /><span className="truncate">{l.nama_asli}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function PilihBerkas({ files, setFiles }: { files: File[]; setFiles: (f: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-1.5">
      <input ref={ref} type="file" multiple accept="application/pdf,image/png,image/jpeg" className="hidden"
        onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])].slice(0, MAKS_BERKAS)); e.target.value = ""; }} />
      <Button type="button" size="sm" variant="soft" onClick={() => ref.current?.click()} disabled={files.length >= MAKS_BERKAS}>
        <Paperclip />Lampirkan PDF/JPG/PNG
      </Button>
      {files.length > 0 && (
        <ul className="space-y-1 text-xs">
          {files.map((f, i) => (
            <li key={i} className="flex items-center justify-between gap-2">
              <span className="truncate">{f.name} · {(f.size / 1024 / 1024).toFixed(1)} MB</span>
              <Button type="button" size="xs" variant="outline" onClick={() => setFiles(files.filter((_, j) => j !== i))}>Hapus</Button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground text-xs">Maks {MAKS_BERKAS} berkas, total 8 MB per catatan.</p>
    </div>
  );
}

function FormCatatan({ id, tahapKode, onSaved }: { id: number; tahapKode: string; onSaved: (d: Detail) => void }) {
  const [catatan, setCatatan] = useState("");
  const [tanggal, setTanggal] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function simpan() {
    setBusy(true);
    setErr(null);
    const fd = new FormData();
    fd.set("tahap_kode", tahapKode);
    fd.set("tanggal", tanggal);
    fd.set("catatan", catatan);
    for (const f of files) fd.append("file", f, f.name);
    try {
      onSaved(await kirim<Detail>(`/api/proyek-hd/${id}/catatan`, { method: "POST", body: fd }));
      setCatatan(""); setTanggal(""); setFiles([]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <Label htmlFor="fc-catatan">Tambah catatan</Label>
      <Textarea id="fc-catatan" rows={3} className="bg-card" value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Progres, kendala, hasil rapat…" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PilihBerkas files={files} setFiles={setFiles} />
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label htmlFor="fc-tgl" className="text-xs">Tanggal (kosong = hari ini)</Label>
            <Input id="fc-tgl" type="date" className="bg-card" value={tanggal} onChange={(e) => setTanggal(e.target.value)} /></div>
          <Button disabled={busy || (!catatan.trim() && !files.length)} onClick={simpan}>{busy ? "Menyimpan…" : "Simpan catatan"}</Button>
        </div>
      </div>
      {err && <p className="text-destructive text-sm">{err}</p>}
    </div>
  );
}

function MajuDialog({ d, onClose, onSaved }: { d: Detail; onClose: () => void; onSaved: (d: Detail) => void }) {
  const p = d.proyek;
  const [ke, setKe] = useState(d.opsi_maju[0]?.kode ?? "");
  const [catatan, setCatatan] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const opsi = d.opsi_maju.map((o) => ({ value: o.kode, label: `${o.kode} ${o.nama}${o.dilompati.length ? ` (lompati ${o.dilompati.join(", ")})` : ""}` }));

  async function simpan() {
    setBusy(true);
    setErr(null);
    const fd = new FormData();
    fd.set("diubah_at", p.diubah_at);
    fd.set("ke_tahap", ke);
    fd.set("catatan", catatan);
    for (const f of files) fd.append("file", f, f.name);
    try {
      const r = await kirim<{ detail: Detail }>(`/api/proyek-hd/${p.id}/maju`, { method: "POST", body: fd });
      onSaved(r.detail);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Tahap {p.tahap_kode} {p.tahap_nama} selesai</DialogTitle>
          <DialogDescription>Tahap yang sudah selesai terkunci. Catatan penutup boleh dikosongkan.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {err && <p className="text-destructive text-sm">{err}</p>}
          <div className="space-y-1"><Label>Lanjut ke tahap</Label>
            <Combobox value={ke} onChange={setKe} options={opsi} /></div>
          <div className="space-y-1"><Label htmlFor="mj-cat">Catatan penutup (opsional)</Label>
            <Textarea id="mj-cat" rows={3} className="bg-card" value={catatan} onChange={(e) => setCatatan(e.target.value)} /></div>
          <PilihBerkas files={files} setFiles={setFiles} />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button disabled={busy || !ke} onClick={simpan}>{busy ? "Menyimpan…" : `Pindah ke ${ke}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Tautkan / ganti / lepas faskes (master pelanggan Accurate) — dipakai bila proyek dibuat
// atau diimpor tanpa faskes. `diubah_at` ikut supaya tak menimpa ubahan orang lain.
function FaskesDialog({ d, onClose, onSaved }: { d: Detail; onClose: () => void; onSaved: (p: Detail["proyek"]) => void }) {
  const p = d.proyek;
  const [pilih, setPilih] = useState<Faskes | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function simpan(accountId: number | null) {
    setBusy(true);
    setErr(null);
    try {
      onSaved(await kirim<Detail["proyek"]>(`/api/proyek-hd/${p.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ diubah_at: p.diubah_at, account_id: accountId }),
      }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Faskes untuk {p.nama_rs}</DialogTitle>
          <DialogDescription>
            {p.faskes_nama ? <>Sekarang tertaut ke <strong>{p.faskes_nama}</strong>.</> : "Proyek ini belum tertaut ke faskes di WRG-OS."} Cari nama atau kode pelanggan Accurate.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {err && <p className="text-destructive text-sm">{err}</p>}
          <CariFaskes value={pilih} onPilih={setPilih} />
        </DialogBody>
        <DialogFooter className="flex-wrap">
          {p.account_id != null && <Button variant="outline" disabled={busy} onClick={() => simpan(null)}>Lepas tautan</Button>}
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button disabled={busy || !pilih} onClick={() => pilih && simpan(pilih.id)}>{busy ? "Menyimpan…" : "Simpan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Karyawan = { id: string; nama: string };

function StatusUnit({ d, bolehUbah, onSaved }: { d: Detail; bolehUbah: boolean; onSaved: (p: Detail["proyek"]) => void }) {
  const p = d.proyek;
  const [f, setF] = useState({ unit_terinstal: String(p.unit_terinstal), unit_running: String(p.unit_running), status_rag: p.status_rag,
    next_action: p.next_action ?? "", pic_employee_id: p.pic_employee_id ?? "" });
  const [karyawan, setKaryawan] = useState<Karyawan[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; teks: string } | null>(null);

  useEffect(() => {
    if (bolehUbah) kirim<{ karyawan: Karyawan[] }>("/api/proyek-hd/ref").then((r) => setKaryawan(r.karyawan)).catch(() => undefined);
  }, [bolehUbah]);
  const opsiPic = useMemo(() => karyawan.map((k) => ({ value: k.id, label: k.nama })), [karyawan]);

  const kotor = Number(f.unit_terinstal) !== p.unit_terinstal || Number(f.unit_running) !== p.unit_running || f.status_rag !== p.status_rag
    || f.next_action.trim() !== (p.next_action ?? "") || f.pic_employee_id !== (p.pic_employee_id ?? "");

  async function simpan() {
    if (Number(f.unit_running) > Number(f.unit_terinstal)) { setMsg({ ok: false, teks: "Unit running tidak boleh melebihi unit terinstal." }); return; }
    setBusy(true);
    setMsg(null);
    try {
      const np = await kirim<Detail["proyek"]>(`/api/proyek-hd/${p.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ diubah_at: p.diubah_at, unit_terinstal: Number(f.unit_terinstal), unit_running: Number(f.unit_running),
          status_rag: f.status_rag, next_action: f.next_action, pic_employee_id: f.pic_employee_id || null }),
      });
      onSaved(np);
      setMsg({ ok: true, teks: "Tersimpan." });
    } catch (e) {
      setMsg({ ok: false, teks: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Unit & status</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-card rounded-md border p-2"><div className="text-muted-foreground text-xs">KSO</div><strong className="text-xl">{p.unit_kso}</strong></div>
          <div className="space-y-1"><Label htmlFor="su-inst" className="text-xs">Terinstal</Label>
            <Input id="su-inst" type="number" min={0} className="bg-card" disabled={!bolehUbah} value={f.unit_terinstal} onChange={(e) => setF({ ...f, unit_terinstal: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="su-run" className="text-xs">Running</Label>
            <Input id="su-run" type="number" min={0} className="bg-card" disabled={!bolehUbah} value={f.unit_running} onChange={(e) => setF({ ...f, unit_running: e.target.value })} /></div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Status</Label>
          <div className="flex gap-2">
            {STATUS_RAG.map((r) => (
              <button key={r} type="button" disabled={!bolehUbah} aria-pressed={f.status_rag === r} onClick={() => setF({ ...f, status_rag: r })}
                className={cn("min-h-9 flex-1 rounded-md border-2 text-sm font-semibold", f.status_rag === r ? RAG_KELAS[r] : "bg-card")}>
                {r}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1"><Label className="text-xs">PIC</Label>
          {bolehUbah ? <Combobox value={f.pic_employee_id} onChange={(v) => setF({ ...f, pic_employee_id: v })} options={opsiPic} emptyOption="—" searchPlaceholder="Cari karyawan…" />
            : <p className="text-sm">{p.pic_nama ?? "—"}</p>}
        </div>
        <div className="space-y-1"><Label htmlFor="su-next" className="text-xs">Langkah berikutnya</Label>
          <Textarea id="su-next" rows={2} className="bg-card" disabled={!bolehUbah} value={f.next_action} onChange={(e) => setF({ ...f, next_action: e.target.value })} /></div>
        {bolehUbah && <Button disabled={busy || !kotor} onClick={simpan}>{busy ? "Menyimpan…" : "Simpan perubahan"}</Button>}
        {msg && <p className={cn("text-sm", msg.ok ? "text-emerald-600" : "text-destructive")}>{msg.teks}</p>}
      </CardContent>
    </Card>
  );
}
