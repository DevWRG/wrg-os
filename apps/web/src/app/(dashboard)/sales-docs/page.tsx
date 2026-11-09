"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SkeletonCardGrid } from "@/components/ui/loading";
import { StatusSphBadge } from "@/components/sph/sph-ui";

interface SalesDoc {
  id: string;
  customer_name: string | null;
  doc_type: string | null;
  title: string | null;
  draft_text: string;
  status: string;
  model_used: string | null;
  approved_by: string | null;
  hod_reviewed_by: string | null;
  nomor_dokumen?: string | null;
  created_at: string;
}

const STATUSES = ["all", "draft", "hod_review", "approved", "sent", "canceled"] as const;
type StatusFilter = (typeof STATUSES)[number];

// Label tombol saring. SPH punya alur 2 tahap sendiri (draft = menunggu review
// HoD, hod_review = menunggu approve) dan dikerjakan di halaman /sph/[id];
// doc_type lain tetap 1 tahap di halaman ini.
const LABEL_FILTER: Record<StatusFilter, string> = {
  all: "Semua",
  draft: "Draf / Review",
  hod_review: "Menunggu Approve",
  approved: "Disetujui",
  sent: "Terkirim",
  canceled: "Dibatalkan",
};
const LABEL_STATUS: Record<string, string> = {
  draft: "Draf",
  approved: "Disetujui",
  sent: "Terkirim",
  canceled: "Dibatalkan",
};

const STATUS_BADGE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "secondary",
  hod_review: "secondary",
  approved: "default",
  sent: "outline",
  canceled: "destructive",
};

export default function SalesDocsPage() {
  const [docs, setDocs] = useState<SalesDoc[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toInputs, setToInputs] = useState<Record<string, string>>({});

  const url = useCallback(
    (f: StatusFilter) => (f === "all" ? "/api/sales/docs" : `/api/sales/docs?status=${f}`),
    [],
  );

  const load = useCallback(
    async (f: StatusFilter) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(url(f), { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "gagal memuat dokumen");
        setDocs(data.docs ?? []);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [url],
  );

  // Initial fetch — inline async (setState hanya setelah await).
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/sales/docs", { cache: "no-store" });
        const data = await res.json();
        if (!active) return;
        if (!res.ok) throw new Error(data.error ?? "gagal memuat dokumen");
        setDocs(data.docs ?? []);
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

  // Aksi untuk doc_type NON-SPH (offering/presentation/MOU). SPH dikerjakan di
  // halaman detail /sph/[id] (review HoD, konfirmasi varian, approve + nomor +
  // penanda tangan, kirim ke kontak WA customer, batal).
  async function act(id: string, action: "approve" | "send" | "cancel") {
    setBusy(id);
    setError(null);
    try {
      const path = `/api/sales/docs/${id}/${action}`;
      // Pelaku (approver/reviewer) diisi server dari sesi — tak dikirim dari sini.
      const body: Record<string, string> = {};
      if (action === "send") {
        const to = (toInputs[id] ?? "").trim();
        if (!to) throw new Error("isi nomor WA kontak customer dulu");
        body.to = to;
      }
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? `gagal ${action}`);
      await load(filter);
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
          <h1 className="text-2xl font-semibold">Sales Docs</h1>
          <p className="text-muted-foreground">
            Dokumen penjualan A6 (SPH / offering / presentation / MOU). SPH diproses di halaman SPH.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {STATUSES.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={filter === s ? "default" : "outline"}
              onClick={() => {
                setFilter(s);
                void load(s);
              }}
            >
              {LABEL_FILTER[s]}
            </Button>
          ))}
          <Button size="sm" variant="soft" className="ml-2" render={<Link href="/sph" />}>
            Daftar SPH
          </Button>
          <Button size="sm" render={<Link href="/sph/new" />}>
            + Buat SPH
          </Button>
        </div>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}
      {loading ? (
        <SkeletonCardGrid count={4} />
      ) : docs.length === 0 ? (
        <p className="text-muted-foreground">Tidak ada dokumen. 🎉</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {docs.map((d) => (
            <Card key={d.id}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div className="min-w-0">
                  <CardTitle className="text-base">{d.title ?? d.customer_name ?? d.id}</CardTitle>
                  <p className="text-muted-foreground text-xs">
                    {d.customer_name ?? "—"} · {d.doc_type ?? "doc"}
                  </p>
                </div>
                {d.doc_type === "sph" ? (
                  <StatusSphBadge status={d.status} />
                ) : (
                  <Badge variant={STATUS_BADGE[d.status] ?? "secondary"}>{LABEL_STATUS[d.status] ?? d.status}</Badge>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                {d.doc_type === "sph" ? (
                  // F15: semua aksi SPH (review HoD, konfirmasi varian, approve +
                  // nomor + penanda tangan, kirim, batal) ada di halaman detail.
                  <div className="space-y-3">
                    <p className="text-muted-foreground text-xs">
                      {d.nomor_dokumen ? (
                        <span className="text-foreground font-mono">{d.nomor_dokumen}</span>
                      ) : (
                        "DRAF — belum bernomor"
                      )}
                      {d.hod_reviewed_by ? ` · review HoD: ${d.hod_reviewed_by}` : ""}
                      {d.approved_by && d.status !== "canceled" ? ` · disetujui: ${d.approved_by}` : ""}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" className="flex-1" render={<Link href={`/sph/${d.id}`} />}>
                        Buka SPH
                      </Button>
                      <Button
                        size="sm"
                        variant="soft"
                        render={<a href={`/api/sph/${d.id}/pdf`} target="_blank" rel="noopener noreferrer" />}
                      >
                        Lihat PDF
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                  <pre className="bg-background max-h-48 overflow-auto rounded-md border p-3 text-xs whitespace-pre-wrap">
                    {d.draft_text}
                  </pre>
                  <a
                    href={`/api/export/sales-doc/${d.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary text-xs underline"
                  >
                    🖨️ Export / Print PDF
                  </a>
                  </>
                )}
                {d.doc_type !== "sph" && d.status === "draft" && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={busy === d.id}
                      onClick={() => void act(d.id, "approve")}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === d.id}
                      onClick={() => void act(d.id, "cancel")}
                    >
                      Batalkan
                    </Button>
                  </div>
                )}
                {d.doc_type !== "sph" && d.status === "approved" && (
                  <div className="space-y-2">
                    <Input
                      placeholder="No. WA kontak customer di Accounts (mis. 0812xxxx)"
                      value={toInputs[d.id] ?? ""}
                      onChange={(e) =>
                        setToInputs((prev) => ({ ...prev, [d.id]: e.target.value }))
                      }
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        disabled={busy === d.id}
                        onClick={() => void act(d.id, "send")}
                      >
                        Kirim
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === d.id}
                        onClick={() => void act(d.id, "cancel")}
                      >
                        Batalkan
                      </Button>
                    </div>
                  </div>
                )}
                {d.doc_type !== "sph" && (d.status === "sent" || d.status === "canceled") && (
                  <p className="text-muted-foreground text-xs">
                    {d.status === "sent" ? "Terkirim" : "Dibatalkan"}
                    {d.approved_by ? ` · oleh ${d.approved_by}` : ""}
                    {d.model_used ? ` · ${d.model_used}` : ""}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
