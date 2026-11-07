"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

// Pratinjau rekap WA mingguan kualitas data ke HoD — hanya menampilkan, tak mengirim.
export function PratinjauRekapKualitas({ region }: { region: "East" | "West" }) {
  const [teks, setTeks] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const muat = async () => {
    setSibuk(true);
    try {
      const res = await fetch(`/api/sales-command/rekap-kualitas-pratinjau?region=${region}`);
      const d = (await res.json().catch(() => ({}))) as { payload?: string; skipped?: string; penerima?: string[]; error?: string };
      if (!res.ok) setTeks(`Gagal memuat pratinjau: ${d.error ?? res.status}`);
      else setTeks(d.payload
        ? `${d.payload}\n\n— penerima: ${d.penerima?.length ? d.penerima.join(", ") : "belum ada — atur grup region atau nomor WA HoD"}`
        : `Tidak ada yang dikirim: ${d.skipped ?? "—"}`);
    } finally { setSibuk(false); }
  };
  return (
    <div className="flex flex-col gap-2">
      <div><Button size="sm" variant="outline" onClick={muat} disabled={sibuk}>{sibuk ? "Memuat…" : "Pratinjau rekap WA ke HoD"}</Button></div>
      {teks !== null && (
        <div className="rounded-lg border p-3">
          <pre className="text-xs whitespace-pre-wrap">{teks}</pre>
          <p className="text-muted-foreground mt-2 text-xs">Dikirim otomatis sekali seminggu (hari kerja pertama, 07.30) ke grup WhatsApp region yang diatur admin sistem (atau WhatsApp pribadi HoD bila grup belum diatur), bila saklarnya dinyalakan.</p>
        </div>
      )}
    </div>
  );
}
