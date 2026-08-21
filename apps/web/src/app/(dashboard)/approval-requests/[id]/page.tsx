"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
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

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/approval-requests/${params.id}`, { cache: "no-store" });
        const data = await res.json();
        if (!active) return;
        if (!res.ok) throw new Error(data.error ?? "gagal memuat data");
        setReq(data);
      } catch (e) {
        if (active) setError(String(e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [params.id]);

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
