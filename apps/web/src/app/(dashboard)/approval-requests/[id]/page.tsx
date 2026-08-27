"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ApprovalStep {
  urutan: number;
  label: string;
  status: string;
  notifiedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}
interface Attachment {
  id: number;
  filename: string;
  mimeType: string;
  fileSize: number;
  uploadedAt: string;
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
  steps: ApprovalStep[];
  attachments: Attachment[];
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
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

export default function ApprovalRequestDetailPage() {
  const params = useParams<{ id: string }>();
  const [req, setReq] = useState<ApprovalRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyNotify, setBusyNotify] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/approval-requests/${params.id}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal memuat data");
      setReq(data);
    } catch (e) {
      setError(String(e));
    }
  }, [params.id]);

  // Inline IIFE (bukan `void load()` langsung di body efek) — set-state
  // sinkron di load() kena lint react-hooks set-state-in-effect, pola sama
  // dgn list page (approval-requests/page.tsx).
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      await load();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [load]);

  async function retryNotify() {
    setBusyNotify(true);
    try {
      const res = await fetch(`/api/approval-requests/${params.id}/notify`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal kirim notifikasi");
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyNotify(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <Link href="/approval-requests" className="text-primary text-sm underline">
        ← Kembali ke daftar
      </Link>

      {error && <p className="text-destructive text-sm">{error}</p>}
      {loading ? (
        <p className="text-muted-foreground">Memuat…</p>
      ) : !req ? (
        <p className="text-muted-foreground">Permintaan tidak ditemukan.</p>
      ) : (
        <>
          {(() => {
            const currentStep = req.steps.find((s) => s.urutan === req.currentUrutan);
            const stuckUnnotified = req.status === "pending" && currentStep && !currentStep.notifiedAt;
            if (!stuckUnnotified) return null;
            return (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
                <p className="mb-2 text-amber-700 dark:text-amber-400">
                  ⚠️ Tahap &quot;{currentStep.label}&quot; belum ternotifikasi — kemungkinan kontaknya belum
                  dikonfigurasi. Cek{" "}
                  <Link href="/approval-requests/config" className="text-primary underline">
                    Setup Kontak
                  </Link>{" "}
                  lalu retry di bawah.
                </p>
                <Button size="sm" variant="outline" disabled={busyNotify} onClick={() => void retryNotify()}>
                  Kirim Ulang Notifikasi
                </Button>
              </div>
            );
          })()}
          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="text-xl">
                  {req.kode} — {req.title}
                </CardTitle>
                <p className="text-muted-foreground text-sm">
                  Diajukan oleh {req.requestedBy}
                  {req.nominal != null ? ` · ${rupiah(req.nominal)}` : ""}
                </p>
              </div>
              <Badge variant={STATUS_BADGE[req.status] ?? "secondary"}>{req.status}</Badge>
            </CardHeader>
            {req.description && (
              <CardContent>
                <p className="text-sm">{req.description}</p>
              </CardContent>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Progress Approval</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {req.steps.map((s) => (
                <div key={s.urutan} className="flex items-center justify-between gap-2 text-sm">
                  <span className={s.urutan === req.currentUrutan ? "font-medium" : ""}>
                    {s.urutan}. {s.label}
                    {s.decidedBy ? ` — ${s.decidedBy}` : ""}
                    {s.decisionNote ? ` (${s.decisionNote})` : ""}
                  </span>
                  <Badge variant={STEP_BADGE[s.status] ?? "outline"}>{s.status}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Lampiran ({req.attachments.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {req.attachments.length === 0 ? (
                <p className="text-muted-foreground text-sm">Tidak ada lampiran.</p>
              ) : (
                <ul className="space-y-1">
                  {req.attachments.map((a) => (
                    <li key={a.id} className="text-sm">
                      <a
                        href={`/api/approval-requests/${req.id}/attachments/${a.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline"
                      >
                        📎 {a.filename}
                      </a>{" "}
                      <span className="text-muted-foreground text-xs">({kb(a.fileSize)})</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
