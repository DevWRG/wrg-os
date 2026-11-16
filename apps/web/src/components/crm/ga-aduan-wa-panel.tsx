"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface GaAduanWa {
  config: { staf_ga_names: string[]; group_jids: string[]; updated_at: string | null; updated_by: string | null };
  statistik: {
    tiket_dari_wa: number;
    tiket_terbuka: number;
    pesan_diproses: number;
    pesan_belum: number;
    per_status: Record<string, number>;
    terakhir_diproses: string | null;
  };
}

const LABEL_STATUS: Record<string, string> = {
  "aduan-baru": "Aduan baru",
  progres: "Progres",
  selesai: "Selesai",
  komentar: "Komentar",
  abaikan: "Diabaikan",
  "tak-tertaut": "Tak tertaut ke tiket",
  "tanpa-putusan": "Tanpa putusan",
};

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }) : "-";

// Pengaturan pemindai grup WA "Aduan GA": siapa staf GA (pembeda balasan GA
// vs pelapor). Pemindai tidak jalan selama daftar ini kosong.
export function GaAduanWaPanel({ data }: { data: GaAduanWa | null }) {
  const router = useRouter();
  const [names, setNames] = useState((data?.config.staf_ga_names ?? []).join(", "));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function simpan(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/ga-aduan-wa/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ staf_ga_names: names.split(",").map((n) => n.trim()).filter(Boolean) }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "gagal menyimpan");
      setMsg({ ok: true, text: "Tersimpan." });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: String(err instanceof Error ? err.message : err) });
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">Data pemindai Aduan WA tidak bisa dimuat.</CardContent>
      </Card>
    );
  }
  const s = data.statistik;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Staf GA di grup WA</CardTitle>
          <CardDescription>
            Pesan di grup &quot;Aduan GA&quot; dicatat otomatis jadi tiket. Balasan dari nama di bawah ini dianggap
            balasan GA (progres/selesai). Isi persis seperti nama tampilan WhatsApp-nya, pisahkan dengan koma.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={simpan} className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="aduan-staf">Nama WA staf GA</Label>
              <Input id="aduan-staf" value={names} onChange={(e) => setNames(e.target.value)} placeholder="mis. Nama Staf, Nama Staf 2" />
            </div>
            {data.config.staf_ga_names.length === 0 ? (
              <p className="text-sm text-amber-700">Belum diisi — pencatatan otomatis belum berjalan.</p>
            ) : null}
            <div className="flex items-center gap-3">
              <Button type="submit" size="sm" disabled={busy}>
                {busy ? "Menyimpan…" : "Simpan"}
              </Button>
              {msg ? <span className={`text-sm ${msg.ok ? "text-emerald-700" : "text-destructive"}`}>{msg.text}</span> : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Terakhir diubah: {fmt(data.config.updated_at)}
              {data.config.updated_by ? ` oleh ${data.config.updated_by}` : ""}
            </p>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Ringkasan pencatatan</CardTitle>
          <CardDescription>Diperbarui tiap 10 menit saat pemindai aktif.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <div className="flex justify-between"><span>Tiket dari WA</span><span className="font-medium">{s.tiket_dari_wa}</span></div>
          <div className="flex justify-between"><span>Masih terbuka</span><span className="font-medium">{s.tiket_terbuka}</span></div>
          <div className="flex justify-between"><span>Pesan sudah diproses</span><span className="font-medium">{s.pesan_diproses}</span></div>
          <div className="flex justify-between"><span>Pesan menunggu</span><span className="font-medium">{s.pesan_belum}</span></div>
          {Object.entries(s.per_status).map(([k, n]) => (
            <div key={k} className="flex justify-between pl-3 text-muted-foreground"><span>{LABEL_STATUS[k] ?? k}</span><span>{n}</span></div>
          ))}
          <p className="pt-1 text-xs text-muted-foreground">Terakhir diproses: {fmt(s.terakhir_diproses)}</p>
        </CardContent>
      </Card>
    </div>
  );
}
