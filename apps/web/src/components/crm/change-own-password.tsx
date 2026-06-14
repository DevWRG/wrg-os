"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ChangeOwnPassword() {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [conf, setConf] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setMsg(null);
    if (next.length < 6) return setMsg({ ok: false, text: "password baru minimal 6 karakter" });
    if (next !== conf) return setMsg({ ok: false, text: "konfirmasi tidak cocok" });
    setBusy(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ current: cur, next }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.ok) { setMsg({ ok: true, text: "Password berhasil diganti." }); setCur(""); setNext(""); setConf(""); }
      else setMsg({ ok: false, text: String(d.error ?? `HTTP ${res.status}`) });
    } catch {
      setMsg({ ok: false, text: "gagal hubungi server" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Ganti Password Saya</CardTitle></CardHeader>
      <CardContent className="max-w-sm space-y-2">
        {msg ? <div className={`rounded-md px-3 py-2 text-sm ${msg.ok ? "bg-[#5a7a1a]/10 text-[#5a7a1a]" : "bg-destructive/10 text-destructive"}`}>{msg.text}</div> : null}
        <div className="grid gap-1"><Label htmlFor="cp-cur">Password lama</Label><Input id="cp-cur" type="password" value={cur} onChange={(e) => setCur(e.target.value)} /></div>
        <div className="grid gap-1"><Label htmlFor="cp-new">Password baru</Label><Input id="cp-new" type="password" value={next} onChange={(e) => setNext(e.target.value)} /></div>
        <div className="grid gap-1"><Label htmlFor="cp-conf">Konfirmasi</Label><Input id="cp-conf" type="password" value={conf} onChange={(e) => setConf(e.target.value)} /></div>
        <Button size="sm" onClick={submit} disabled={busy}>Ganti password</Button>
      </CardContent>
    </Card>
  );
}
