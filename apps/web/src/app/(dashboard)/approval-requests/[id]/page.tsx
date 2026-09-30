"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonCardGrid } from "@/components/ui/loading";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KATEGORI_OPTIONS, labelKategori, labelWilayah, WILAYAH_OPTIONS } from "@/lib/approval-routing";

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
  wilayah: string | null;
  kategori: string | null;
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
  const [draftWilayah, setDraftWilayah] = useState("");
  const [draftKategori, setDraftKategori] = useState("");
  const [busyAtribut, setBusyAtribut] = useState(false);
  const [atributInfo, setAtributInfo] = useState<string | null>(null);

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

  // Request lama / dari pemanggil lain (mis. F19 forecast) bisa dibuat tanpa
  // wilayah/kategori — tahap 1/2 lalu tertahan. Di sini atribut yg KOSONG bisa
  // dilengkapi; yang sudah terisi tidak bisa diganti (API menolak).
  async function saveAtribut() {
    if (!req) return;
    const body: Record<string, string> = {};
    if (!req.wilayah && draftWilayah) body.wilayah = draftWilayah;
    if (!req.kategori && draftKategori) body.kategori = draftKategori;
    if (Object.keys(body).length === 0) return;
    setBusyAtribut(true);
    setAtributInfo(null);
    try {
      const res = await fetch(`/api/approval-requests/${params.id}/atribut`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal menyimpan");
      if (data.notify && data.notify.ok === false) {
        setAtributInfo(`Tersimpan, tapi notifikasi tahap sekarang masih gagal: ${data.notify.error}`);
      }
      setDraftWilayah("");
      setDraftKategori("");
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyAtribut(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <Link href="/approval-requests" className="text-primary text-sm underline">
        ← Kembali ke daftar
      </Link>

      {error && <p className="text-destructive text-sm">{error}</p>}
      {loading ? (
        <SkeletonCardGrid count={2} lines={5} className="md:grid-cols-1" />
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
                  {` · Wilayah ${labelWilayah(req.wilayah)} · Kategori ${labelKategori(req.kategori)}`}
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

          {req.status === "pending" && (!req.wilayah || !req.kategori) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Lengkapi Atribut Routing</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-muted-foreground text-xs">
                  Tahap 1 (HoD Sales) dipilih dari wilayah pengaju, tahap 2 (HoD Bisnis) dari kategori barang. Permintaan
                  ini dibuat tanpa salah satunya, jadi tahap itu tertahan. Nilai yang sudah terisi tidak bisa diganti.
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  {!req.wilayah && (
                    <div className="min-w-56">
                      <Select value={draftWilayah} onValueChange={(v) => setDraftWilayah(v ?? "")}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Pilih wilayah" />
                        </SelectTrigger>
                        <SelectContent>
                          {WILAYAH_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {!req.kategori && (
                    <div className="min-w-56">
                      <Select value={draftKategori} onValueChange={(v) => setDraftKategori(v ?? "")}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Pilih kategori" />
                        </SelectTrigger>
                        <SelectContent>
                          {KATEGORI_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <Button
                    size="sm"
                    disabled={busyAtribut || (!draftWilayah && !draftKategori)}
                    onClick={() => void saveAtribut()}
                  >
                    Simpan & Kirim Notifikasi
                  </Button>
                </div>
                {atributInfo && <p className="text-sm text-amber-700 dark:text-amber-400">{atributInfo}</p>}
              </CardContent>
            </Card>
          )}

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
