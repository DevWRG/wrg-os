"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

export interface AccurateSyncStatus {
  configured: boolean;
  running: boolean;
  last_synced_at: string | null;
  last_run_ok: boolean | null;
  summary: { error?: string; headers?: number; details?: number; pending_details?: number } | null;
}

// timestamptz::text dari Postgres ("2026-10-12 10:30:12.1+00") → jam WIB.
const jam = (s: string) => {
  const d = new Date(s.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
};

// Cermin Accurate — PO Tracker (F13, migrasi 205) & Inbound (F36, 206).
// Tombol memicu sinkron di latar lalu menunggu sampai selesai (poll GET
// `endpoint`), baru me-refresh halaman. Job accurate-po-sync melakukan hal
// yang sama secara berkala. `endpoint` = route BFF dengan GET status + POST picu.
export function SyncAccurateButton({ initial, endpoint }: { initial: AccurateSyncStatus | null; endpoint: string }) {
  const router = useRouter();
  const [st, setSt] = useState<AccurateSyncStatus | null>(initial);
  const [err, setErr] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(initial?.running ?? false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!waiting) return;
    timer.current = setInterval(async () => {
      const res = await fetch(endpoint).catch(() => null);
      if (!res?.ok) return;
      const next = (await res.json()) as AccurateSyncStatus;
      setSt(next);
      if (!next.running) {
        setWaiting(false);
        router.refresh();
      }
    }, 4000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [waiting, router, endpoint]);

  async function mulai() {
    setErr(null);
    const res = await fetch(endpoint, { method: "POST" }).catch(() => null);
    if (!res) return setErr("Gagal menghubungi server");
    const data = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 409) return setErr(data.error ?? `Gagal (HTTP ${res.status})`);
    setWaiting(true);
  }

  const info = waiting
    ? "Menyinkronkan dari Accurate…"
    : st?.last_synced_at
      ? `Sinkron terakhir ${jam(st.last_synced_at)}${st.last_run_ok === false ? " — GAGAL" : ""}`
      : "Belum pernah disinkron";

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="outline" disabled={waiting || st?.configured === false} onClick={mulai}>
        <RefreshCw className={waiting ? "animate-spin" : ""} /> Sinkron dari Accurate
      </Button>
      <span className={`text-xs ${st?.last_run_ok === false || err ? "text-destructive" : "text-muted-foreground"}`}>
        {err ?? (st?.configured === false ? "Kredensial Accurate tak tersedia di server ini" : info)}
        {!waiting && st?.last_run_ok === false && st.summary?.error ? ` (${st.summary.error})` : ""}
      </span>
    </div>
  );
}
