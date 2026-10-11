"use client";

import { useRef, useState } from "react";
import { FileText, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { JENIS_DOKUMEN_LABEL, kirim, type DokumenKontrak, type JenisDokumen } from "./types";

const ukuranTeks = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const MAKS = 8 * 1024 * 1024; // sama dengan MAKS_DOKUMEN di apps/api

// Dokumen kontrak (MoU/addendum/BAST). State daftar dipegang sendiri supaya
// unggah/hapus tak memuat ulang dialog induk — isian form kontrak yang belum
// disimpan tidak ikut tertimpa. Tipe & ukuran divalidasi ulang di apps/api.
export function DokumenKontrakSection({ kontrakId, awal, canEdit }: { kontrakId: string; awal: DokumenKontrak[]; canEdit: boolean }) {
  const [dok, setDok] = useState(awal);
  const [jenis, setJenis] = useState<JenisDokumen>("MOU");
  const [ket, setKet] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function unggah(file: File) {
    setErr(null);
    if (file.size > MAKS) { setErr("File maksimal 8 MB."); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file, file.name);
      fd.set("jenis", jenis);
      fd.set("keterangan", ket);
      const baru = await kirim<DokumenKontrak>(`/api/kso-kontrak/${kontrakId}/dokumen`, { method: "POST", body: fd });
      setDok([baru, ...dok]);
      setKet("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function hapus(d: DokumenKontrak) {
    if (!window.confirm(`Hapus dokumen “${d.nama}”?`)) return;
    setErr(null);
    setBusy(true);
    try {
      await kirim(`/api/kso-kontrak/${kontrakId}/dokumen/${d.id}`, { method: "DELETE" });
      setDok(dok.filter((x) => x.id !== d.id));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Label>Dokumen kontrak ({dok.length})</Label>
      {err && <p className="text-destructive text-sm">{err}</p>}
      {dok.length === 0 ? (
        <p className="text-muted-foreground text-xs">Belum ada dokumen. {canEdit ? "Unggah scan MoU yang sudah ditandatangani di bawah." : ""}</p>
      ) : (
        <ul className="divide-y rounded-md border text-sm">
          {dok.map((d) => (
            <li key={d.id} className="flex items-center gap-2 px-2 py-1.5">
              <FileText className="text-muted-foreground size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <a href={`/api/kso-kontrak/${kontrakId}/dokumen/${d.id}`} target="_blank" rel="noopener noreferrer"
                  className="text-primary block truncate font-medium hover:underline">{d.nama}</a>
                <div className="text-muted-foreground text-xs">
                  {JENIS_DOKUMEN_LABEL[d.jenis]} · {ukuranTeks(d.ukuran)} · {d.created_at.slice(0, 10)}{d.oleh ? ` · ${d.oleh}` : ""}
                  {d.keterangan ? ` · ${d.keterangan}` : ""}
                </div>
              </div>
              {canEdit && (
                <Button type="button" size="icon" variant="ghost" aria-label={`Hapus ${d.nama}`} disabled={busy} onClick={() => hapus(d)}>
                  <Trash2 className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="space-y-2 rounded-md border border-dashed p-2">
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(JENIS_DOKUMEN_LABEL) as JenisDokumen[]).map((j) => (
              <Button key={j} type="button" size="sm" variant={jenis === j ? "default" : "soft"} onClick={() => setJenis(j)}>{JENIS_DOKUMEN_LABEL[j]}</Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input className="min-w-40 flex-1" placeholder="Keterangan (opsional)" value={ket} onChange={(e) => setKet(e.target.value)} />
            <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void unggah(f); }} />
            <Button type="button" size="sm" disabled={busy} onClick={() => input.current?.click()}>
              <Upload className="size-4" />{busy ? "Mengunggah…" : "Unggah file"}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">PDF, JPG, atau PNG · maks. 8 MB</p>
        </div>
      )}
    </div>
  );
}
