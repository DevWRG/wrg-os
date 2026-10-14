"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import {
  CASE_CLS, CASE_LABEL, ITEM_CLS, KATEGORI, KATEGORI_LABEL, hariIni, jsonInit, kirim, tglId,
  type Candidate, type CaseStatus, type ItemStatus, type Kategori, type OnboardingCase, type OnboardingItem, type Template,
} from "./types";

const selCls = "h-9 w-full rounded-md border border-border bg-card px-2 text-sm";

// ── Mulai onboarding ────────────────────────────────────────────────────────

export function MulaiDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [kandidat, setKandidat] = useState<Candidate[]>([]);
  const [emp, setEmp] = useState("");
  const [mulai, setMulai] = useState(hariIni());
  const [catatan, setCatatan] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let batal = false;
    kirim<{ items: Candidate[] }>("/api/onboarding/candidates")
      .then((d) => { if (!batal) setKandidat(d.items); })
      .catch((e) => { if (!batal) setErr((e as Error).message); });
    return () => { batal = true; };
  }, [open]);

  async function simpan() {
    setBusy(true);
    setErr(null);
    try {
      await kirim("/api/onboarding", jsonInit("POST", { employee_id: emp, tanggal_mulai: mulai, catatan: catatan || null }));
      router.refresh();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Mulai onboarding</DialogTitle>
          <DialogDescription>Checklist dibentuk dari template yang cocok dengan departemen & jabatan karyawan.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {err && <p className="text-destructive text-sm">{err}</p>}
          <div className="space-y-1"><Label htmlFor="ob-emp">Karyawan *</Label>
            <select id="ob-emp" className={selCls} value={emp} onChange={(e) => setEmp(e.target.value)}>
              <option value="">— pilih —</option>
              {kandidat.map((c) => (
                <option key={c.id} value={c.id}>{c.roster_pending ? "● " : ""}{c.nama}{c.role ? ` — ${c.role}` : ""}</option>
              ))}
            </select>
            <p className="text-muted-foreground text-xs">● = belum masuk roster (onboarding berjalan).</p></div>
          <div className="space-y-1"><Label htmlFor="ob-mulai">Tanggal mulai</Label>
            <Input id="ob-mulai" type="date" value={mulai} onChange={(e) => setMulai(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="ob-cat">Catatan</Label>
            <Textarea id="ob-cat" rows={2} value={catatan} onChange={(e) => setCatatan(e.target.value)} /></div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button disabled={busy || !emp || !mulai} onClick={() => void simpan()}>{busy ? "Menyimpan…" : "Mulai"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Detail checklist ────────────────────────────────────────────────────────

type Detail = OnboardingCase & { items: OnboardingItem[] };

export function DetailDialog({ id, onClose, bolehUbah }: { id: number | null; onClose: () => void; bolehUbah: boolean }) {
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [alasan, setAlasan] = useState<{ id: number; teks: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (id == null) return;
    let batal = false;
    kirim<Detail>(`/api/onboarding/${id}`)
      .then((r) => { if (!batal) setD(r); })
      .catch((e) => { if (!batal) setErr((e as Error).message); });
    return () => { batal = true; };
  }, [id]);

  async function muat() {
    if (id == null) return;
    setD(await kirim<Detail>(`/api/onboarding/${id}`));
    router.refresh();
  }

  async function aksi(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await muat();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const ubah = (itemId: number, status: ItemStatus, catatan?: string) =>
    aksi(async () => {
      await kirim(`/api/onboarding/items/${itemId}`, jsonInit("PATCH", { status, catatan: catatan ?? null }));
      setAlasan(null);
    });

  const aktif = bolehUbah && d?.status !== "dibatalkan";

  return (
    <Dialog open={id != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{d ? `Onboarding — ${d.nama}` : "Onboarding"}</DialogTitle>
          {d && (
            <DialogDescription>
              {[d.role, d.cabang].filter(Boolean).join(" · ") || "—"} · mulai {tglId(d.tanggal_mulai)} · {d.progress.persen}% ({d.progress.selesai + d.progress.dilewati}/{d.progress.total})
            </DialogDescription>
          )}
        </DialogHeader>
        <DialogBody className="space-y-4">
          {err && <p className="text-destructive text-sm">{err}</p>}
          {!d && !err && <p className="text-muted-foreground text-sm">Memuat…</p>}
          {d && KATEGORI.map((k) => {
            const items = d.items.filter((i) => i.kategori === k);
            if (!items.length) return null;
            return (
              <section key={k} className="space-y-2">
                <h3 className="text-sm font-semibold">{KATEGORI_LABEL[k]}</h3>
                {items.map((i) => (
                  <div key={i.id} className="rounded-md border p-2.5 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 break-words">
                        <div className="font-medium">{i.judul}</div>
                        {i.keterangan && <div className="text-muted-foreground text-xs">{i.keterangan}</div>}
                        <div className={cn("text-xs", i.terlambat ? "font-medium text-rose-700 dark:text-rose-400" : "text-muted-foreground")}>
                          Tenggat {tglId(i.due_date)}{i.terlambat ? " · terlambat" : ""}{i.pic ? ` · PIC ${i.pic}` : ""}
                        </div>
                        {i.status !== "belum" && (
                          <div className="text-muted-foreground text-xs break-words">
                            {i.status === "selesai" ? "Selesai" : "Dilewati"} oleh {i.done_by ?? "—"} · {tglId(i.done_at)}{i.catatan ? ` — ${i.catatan}` : ""}
                          </div>
                        )}
                      </div>
                      <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", ITEM_CLS[i.status])}>{i.status}</span>
                    </div>
                    {aktif && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {i.status === "belum" ? (
                          <>
                            <Button size="sm" disabled={busy} onClick={() => void ubah(i.id, "selesai")}>Selesai</Button>
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAlasan({ id: i.id, teks: "" })}>Lewati…</Button>
                          </>
                        ) : (
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void ubah(i.id, "belum")}>Buka lagi</Button>
                        )}
                      </div>
                    )}
                    {alasan?.id === i.id && (
                      <div className="mt-2 flex gap-2">
                        <Input value={alasan.teks} placeholder="Alasan dilewati (wajib)" onChange={(e) => setAlasan({ id: i.id, teks: e.target.value })} />
                        <Button size="sm" disabled={busy || !alasan.teks.trim()} onClick={() => void ubah(i.id, "dilewati", alasan.teks)}>Simpan</Button>
                      </div>
                    )}
                  </div>
                ))}
              </section>
            );
          })}
        </DialogBody>
        <DialogFooter>
          {d && <span className={cn("mr-auto rounded px-1.5 py-0.5 text-xs font-semibold", CASE_CLS[d.status as CaseStatus])}>{CASE_LABEL[d.status as CaseStatus]}</span>}
          {d && d.status === "berjalan" && bolehUbah && (
            <Button variant="ghost" disabled={busy} onClick={() => {
              if (window.confirm(`Batalkan onboarding ${d.nama}? Tidak bisa dibuka lagi.`)) void aksi(() => kirim(`/api/onboarding/${d.id}/cancel`, { method: "POST" }));
            }}>Batalkan onboarding</Button>
          )}
          <Button variant="ghost" onClick={onClose}>Tutup</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Template (tambah / ubah) — dipasang dengan key, jadi state awal dari `awal` ──

export function TemplateDialog({ open, awal, dept, onClose }: {
  open: boolean; awal: Template | null; dept: { key: string; label: string }[]; onClose: () => void;
}) {
  const router = useRouter();
  const [f, setF] = useState(() => awal
    ? { kategori: awal.kategori, judul: awal.judul, keterangan: awal.keterangan ?? "", dept: awal.dept ?? "", role_pattern: awal.role_pattern ?? "", due_days: String(awal.due_days), pic: awal.pic ?? "", urut: String(awal.urut) }
    : { kategori: "akses_sistem" as Kategori, judul: "", keterangan: "", dept: "", role_pattern: "", due_days: "7", pic: "", urut: "0" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function simpan() {
    setBusy(true);
    setErr(null);
    try {
      const body = { ...f, dept: f.dept || null, due_days: Number(f.due_days), urut: Number(f.urut) };
      await kirim(awal ? `/api/onboarding/templates/${awal.id}` : "/api/onboarding/templates", jsonInit(awal ? "PATCH" : "POST", body));
      router.refresh();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{awal ? "Ubah template" : "Tambah template"}</DialogTitle>
          <DialogDescription>Berlaku untuk onboarding yang dimulai sesudahnya; onboarding berjalan tidak berubah.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-3 sm:grid-cols-2">
          {err && <p className="text-destructive text-sm sm:col-span-2">{err}</p>}
          <div className="space-y-1"><Label htmlFor="tp-kat">Kategori</Label>
            <select id="tp-kat" className={selCls} value={f.kategori} onChange={(e) => setF({ ...f, kategori: e.target.value as Kategori })}>
              {KATEGORI.map((k) => <option key={k} value={k}>{KATEGORI_LABEL[k]}</option>)}
            </select></div>
          <div className="space-y-1"><Label htmlFor="tp-pic">PIC</Label>
            <Input id="tp-pic" value={f.pic} placeholder="HRD / IT / HoD" onChange={(e) => setF({ ...f, pic: e.target.value })} /></div>
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="tp-judul">Judul *</Label>
            <Input id="tp-judul" value={f.judul} onChange={(e) => setF({ ...f, judul: e.target.value })} /></div>
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="tp-ket">Keterangan</Label>
            <Textarea id="tp-ket" rows={2} value={f.keterangan} onChange={(e) => setF({ ...f, keterangan: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="tp-dept">Departemen</Label>
            <select id="tp-dept" className={selCls} value={f.dept} onChange={(e) => setF({ ...f, dept: e.target.value })}>
              <option value="">Semua departemen</option>
              {dept.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select></div>
          <div className="space-y-1"><Label htmlFor="tp-role">Pola jabatan</Label>
            <Input id="tp-role" value={f.role_pattern} placeholder="kosong = semua; mis. teknisi" onChange={(e) => setF({ ...f, role_pattern: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="tp-due">Tenggat (hari sejak mulai)</Label>
            <Input id="tp-due" type="number" min={0} max={365} value={f.due_days} onChange={(e) => setF({ ...f, due_days: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="tp-urut">Urutan</Label>
            <Input id="tp-urut" type="number" value={f.urut} onChange={(e) => setF({ ...f, urut: e.target.value })} /></div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button disabled={busy || !f.judul.trim()} onClick={() => void simpan()}>{busy ? "Menyimpan…" : "Simpan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
