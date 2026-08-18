"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ApprovalStep {
  urutan: number;
  label: string;
  status: string;
  notifiedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

interface ApprovalRequest {
  id: string;
  kode: string;
  title: string;
  description: string | null;
  nominal: number | null;
  requestedBy: string;
  status: string;
  currentUrutan: number | null;
  createdAt: string;
  decidedAt: string | null;
  steps: ApprovalStep[];
  attachments: { id: number; filename: string }[];
}

const ALLOWED_ATTACHMENT_TYPES = new Set(["application/pdf", "image/png"]);
const MAX_ATTACHMENT_MB = 8;

function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => rej(reader.error);
    reader.readAsDataURL(file);
  });
}

const STATUS_BADGE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
  canceled: "outline",
};
const STEP_BADGE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "outline",
  approved: "default",
  rejected: "destructive",
  skipped: "secondary",
};

const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

export default function ApprovalRequestsPage() {
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [nominal, setNominal] = useState("");
  const [requestedBy, setRequestedBy] = useState("");
  const [requestedByWa, setRequestedByWa] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function onPickFiles(picked: FileList | null) {
    if (!picked) return;
    setSubmitError(null);
    const next: File[] = [];
    for (const f of Array.from(picked)) {
      if (!ALLOWED_ATTACHMENT_TYPES.has(f.type)) {
        setSubmitError(`"${f.name}": cuma PDF atau PNG yang didukung`);
        return;
      }
      if (f.size > MAX_ATTACHMENT_MB * 1024 * 1024) {
        setSubmitError(`"${f.name}": ukuran melebihi ${MAX_ATTACHMENT_MB}MB`);
        return;
      }
      next.push(f);
    }
    setFiles((prev) => [...prev, ...next]);
  }
  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/approval-requests", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal memuat data");
      setRequests(data.requests ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Inline IIFE (bukan `void load()` langsung) — load() mulai dgn setState
  // sinkron, dipanggil langsung dari body efek kena lint react-hooks
  // set-state-in-effect (pola sama hitl/calendar page).
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/approval-requests", { cache: "no-store" });
        const data = await res.json();
        if (!active) return;
        if (!res.ok) throw new Error(data.error ?? "gagal memuat data");
        setRequests(data.requests ?? []);
      } catch (e) {
        if (active) setError(String(e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function submit() {
    setSubmitError(null);
    if (!title.trim() || !requestedBy.trim()) {
      setSubmitError("title & requestedBy wajib diisi");
      return;
    }
    setSubmitting(true);
    try {
      const attachments = await Promise.all(
        files.map(async (f) => ({ filename: f.name, mimeType: f.type, dataBase64: await fileToBase64(f) })),
      );
      const res = await fetch("/api/approval-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          description: description || null,
          nominal: nominal ? Number(nominal) : null,
          requestedBy,
          requestedByWa: requestedByWa || null,
          attachments,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal membuat permintaan");
      setTitle("");
      setDescription("");
      setNominal("");
      setRequestedBy("");
      setRequestedByWa("");
      setFiles([]);
      await load();
    } catch (e) {
      setSubmitError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function retryNotify(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/approval-requests/${id}/notify`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal kirim notifikasi");
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Approval Requests</h1>
          <p className="text-muted-foreground">
            F11 — engine approval berjenjang: HoD Sales → HoD Bisnis → HoD After Sales → HoD Supply Chain →
            Direktur, notifikasi WA privat bertahap. Balas via WA: <code>#APPROVE &lt;kode&gt;</code> /{" "}
            <code>#REJECT &lt;kode&gt; alasan</code>.
          </p>
        </div>
        <Link href="/approval-requests/config">
          <Button variant="outline" size="sm">
            Setup Kontak per Tahap
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Buat Permintaan Baru</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label className="mb-1 block text-xs">Judul *</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="mis. Diskon khusus RS X" />
            </div>
            <div>
              <Label className="mb-1 block text-xs">Nominal (Rp, opsional)</Label>
              <Input type="number" value={nominal} onChange={(e) => setNominal(e.target.value)} placeholder="mis. 25000000" />
            </div>
            <div className="md:col-span-2">
              <Label className="mb-1 block text-xs">Deskripsi</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="detail permintaan" />
            </div>
            <div>
              <Label className="mb-1 block text-xs">Diajukan oleh *</Label>
              <Input value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} placeholder="nama kamu" />
            </div>
            <div>
              <Label className="mb-1 block text-xs">WA kamu (opsional, buat notif hasil akhir)</Label>
              <Input value={requestedByWa} onChange={(e) => setRequestedByWa(e.target.value)} placeholder="628..." />
            </div>
            <div className="md:col-span-2">
              <Label className="mb-1 block text-xs">Lampiran (opsional — PDF/PNG, maks {MAX_ATTACHMENT_MB}MB/file)</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/png"
                multiple
                className="hidden"
                onChange={(e) => {
                  onPickFiles(e.target.files);
                  e.target.value = ""; // biar bisa pilih file sama lagi kalau mau
                }}
              />
              <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()}>
                Pilih File
              </Button>
              {files.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="text-muted-foreground flex items-center gap-2 text-xs">
                      📎 {f.name} ({(f.size / 1024).toFixed(0)} KB)
                      <button type="button" onClick={() => removeFile(i)} className="text-destructive underline">
                        hapus
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          {submitError && <p className="text-destructive text-sm">{submitError}</p>}
          <Button onClick={() => void submit()} disabled={submitting}>
            {submitting ? "Mengirim…" : "Ajukan Approval"}
          </Button>
        </CardContent>
      </Card>

      {error && <p className="text-destructive text-sm">{error}</p>}
      {loading ? (
        <p className="text-muted-foreground">Memuat…</p>
      ) : requests.length === 0 ? (
        <p className="text-muted-foreground">Belum ada permintaan approval.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {requests.map((r) => {
            const currentStep = r.steps.find((s) => s.urutan === r.currentUrutan);
            const stuckUnnotified = r.status === "pending" && currentStep && !currentStep.notifiedAt;
            return (
              <Card key={r.id}>
                <CardHeader className="flex flex-row items-start justify-between space-y-0">
                  <div className="min-w-0">
                    <CardTitle className="text-base">
                      <Link href={`/approval-requests/${r.id}`} className="hover:underline">
                        {r.kode} — {r.title}
                      </Link>
                    </CardTitle>
                    <p className="text-muted-foreground text-xs">
                      Oleh {r.requestedBy}
                      {r.nominal != null ? ` · ${rupiah(r.nominal)}` : ""}
                      {r.attachments.length > 0 ? ` · 📎 ${r.attachments.length}` : ""}
                    </p>
                  </div>
                  <Badge variant={STATUS_BADGE[r.status] ?? "secondary"}>{r.status}</Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  {r.description && <p className="text-sm">{r.description}</p>}
                  <div className="space-y-1">
                    {r.steps.map((s) => (
                      <div key={s.urutan} className="flex items-center justify-between gap-2 text-xs">
                        <span className={s.urutan === r.currentUrutan ? "font-medium" : ""}>
                          {s.urutan}. {s.label}
                          {s.decidedBy ? ` — ${s.decidedBy}` : ""}
                          {s.decisionNote ? ` (${s.decisionNote})` : ""}
                        </span>
                        <Badge variant={STEP_BADGE[s.status] ?? "outline"}>{s.status}</Badge>
                      </div>
                    ))}
                  </div>
                  {stuckUnnotified && (
                    <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs dark:border-amber-800 dark:bg-amber-950">
                      <p className="mb-1 text-amber-700 dark:text-amber-400">
                        ⚠️ Tahap &quot;{currentStep?.label}&quot; belum ternotifikasi — kemungkinan kontaknya belum
                        dikonfigurasi. Cek{" "}
                        <Link href="/approval-requests/config" className="text-primary underline">
                          Setup Kontak
                        </Link>{" "}
                        lalu retry di bawah.
                      </p>
                      <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => void retryNotify(r.id)}>
                        Kirim Ulang Notifikasi
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
