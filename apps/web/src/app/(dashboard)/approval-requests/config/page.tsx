"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Selaras HODS di apps/api/src/hod-resolver.ts — daftar 8 HoD kanonik.
// Duplikat sengaja (bukan endpoint baru cuma buat 8 baris statis ini).
const HOD_OPTIONS = [
  { key: "rocky", label: "Rocky — HoD Sales East" },
  { key: "yogi", label: "Yogi — HoD Sales West" },
  { key: "muhid", label: "Muhid — HoD Aftersales" },
  { key: "ika", label: "Ika — HoD Finance & SC" },
  { key: "mufid", label: "Mufid — HoD Business IVD" },
  { key: "arman", label: "Arman — HoD Business Medical" },
  { key: "fafa", label: "Fafa — HoD Accounting & Tax" },
  { key: "husni", label: "Husni — HoD BD & GA" },
];
const NONE = "__none__";

interface ChainRow {
  urutan: number;
  label: string;
  targetType: "hod" | "direktur";
  hodKey: string | null;
  waNumberOverride: string | null;
  catatan: string | null;
}

export default function ApprovalConfigPage() {
  const [rows, setRows] = useState<ChainRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<number | null>(null);
  const [overrideDrafts, setOverrideDrafts] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/approval-requests/config/chain", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal memuat config");
      setRows(data.rows ?? []);
      setOverrideDrafts(Object.fromEntries((data.rows ?? []).map((r: ChainRow) => [r.urutan, r.waNumberOverride ?? ""])));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Inline IIFE (bukan `void load()` langsung) — hindari lint react-hooks
  // set-state-in-effect (pola sama hitl/calendar page).
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/approval-requests/config/chain", { cache: "no-store" });
        const data = await res.json();
        if (!active) return;
        if (!res.ok) throw new Error(data.error ?? "gagal memuat config");
        setRows(data.rows ?? []);
        setOverrideDrafts(Object.fromEntries((data.rows ?? []).map((r: ChainRow) => [r.urutan, r.waNumberOverride ?? ""])));
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

  async function saveHodKey(urutan: number, hodKey: string) {
    setSaving(urutan);
    try {
      const res = await fetch(`/api/approval-requests/config/chain/${urutan}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hodKey: hodKey === NONE ? null : hodKey }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal simpan");
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(null);
    }
  }

  async function saveOverride(urutan: number) {
    setSaving(urutan);
    try {
      const val = overrideDrafts[urutan]?.trim() || null;
      const res = await fetch(`/api/approval-requests/config/chain/${urutan}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ waNumberOverride: val }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal simpan");
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Setup Kontak Approval</h1>
        <p className="text-muted-foreground">
          F11 — tentukan siapa HoD di tiap tahap chain. Kosong = belum dikonfigurasi, request akan tertahan
          (tidak error) sampai diisi.{" "}
          <Link href="/approval-requests" className="text-primary underline">
            Kembali ke Approval Requests
          </Link>
        </p>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}
      {loading ? (
        <p className="text-muted-foreground">Memuat…</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.urutan}>
              <CardHeader>
                <CardTitle className="text-base">
                  Tahap {r.urutan} — {r.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {r.catatan && <p className="text-muted-foreground text-xs">{r.catatan}</p>}
                {r.targetType === "hod" ? (
                  <div className="flex items-end gap-3">
                    <div className="min-w-56">
                      <Label className="mb-1 block text-xs">Pilih HoD</Label>
                      <Select value={r.hodKey ?? NONE} onValueChange={(v) => void saveHodKey(r.urutan, v ?? NONE)}>
                        <SelectTrigger>
                          <SelectValue placeholder="Belum dipilih" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>(belum dipilih)</SelectItem>
                          {HOD_OPTIONS.map((h) => (
                            <SelectItem key={h.key} value={h.key}>
                              {h.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {saving === r.urutan && <span className="text-muted-foreground text-xs">menyimpan…</span>}
                  </div>
                ) : (
                  <p className="text-sm">
                    Otomatis resolve ke akun dashboard dengan role <code>direktur</code>.
                  </p>
                )}
                <div className="flex items-end gap-2">
                  <div className="min-w-64 flex-1">
                    <Label className="mb-1 block text-xs">
                      Override nomor WA (opsional — dipakai kalau orangnya belum punya akun dashboard, mis. bukan HoD)
                    </Label>
                    <Input
                      value={overrideDrafts[r.urutan] ?? ""}
                      onChange={(e) => setOverrideDrafts((prev) => ({ ...prev, [r.urutan]: e.target.value }))}
                      placeholder="628..."
                    />
                  </div>
                  <Button size="sm" variant="outline" disabled={saving === r.urutan} onClick={() => void saveOverride(r.urutan)}>
                    Simpan
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
