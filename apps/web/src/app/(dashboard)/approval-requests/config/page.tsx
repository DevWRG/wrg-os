"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SkeletonCardGrid } from "@/components/ui/loading";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useHodOptions } from "@/components/watchpoint/hod-options";
import { KATEGORI_OPTIONS, WILAYAH_OPTIONS } from "@/lib/approval-routing";

const NONE = "__none__";

interface ChainRow {
  urutan: number;
  label: string;
  targetType: "hod" | "direktur";
  hodKey: string | null;
  waNumberOverride: string | null;
  catatan: string | null;
  // Migrasi 190 (#1071): tahap yang orangnya dipilih per atribut request.
  routing: "tetap" | "wilayah" | "kategori";
  hodKeyMap: Record<string, string> | null;
}

function opsiPeta(routing: ChainRow["routing"]) {
  return routing === "wilayah" ? WILAYAH_OPTIONS : routing === "kategori" ? KATEGORI_OPTIONS : [];
}

export default function ApprovalConfigPage() {
  const { hods: hodOptions } = useHodOptions();
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

  async function saveMapEntry(urutan: number, key: string, hodKey: string) {
    setSaving(urutan);
    try {
      const res = await fetch(`/api/approval-requests/config/chain/${urutan}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hodKeyMap: { [key]: hodKey === NONE ? null : hodKey } }),
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
        <SkeletonCardGrid count={3} className="gap-3 md:grid-cols-1" />
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
                {r.targetType === "hod" && r.routing !== "tetap" ? (
                  <div className="space-y-2">
                    <p className="text-sm">
                      Diarahkan per <b>{r.routing === "wilayah" ? "wilayah pengaju" : "kategori barang"}</b> — tiap
                      permintaan membawa nilainya, HoD dipilih dari peta ini.
                    </p>
                    {opsiPeta(r.routing).map((o) => (
                      <div key={o.value} className="flex items-end gap-3">
                        <div className="min-w-56">
                          <Label className="mb-1 block text-xs">{o.label.split(" — ")[0]}</Label>
                          <Select
                            value={r.hodKeyMap?.[o.value] ?? NONE}
                            onValueChange={(v) => void saveMapEntry(r.urutan, o.value, v ?? NONE)}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Belum dipilih" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>(belum dipilih)</SelectItem>
                              {hodOptions.map((h) => (
                                <SelectItem key={h.key} value={h.key}>
                                  {h.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    ))}
                    {saving === r.urutan && <span className="text-muted-foreground text-xs">menyimpan…</span>}
                  </div>
                ) : r.targetType === "hod" ? (
                  <div className="flex items-end gap-3">
                    <div className="min-w-56">
                      <Label className="mb-1 block text-xs">Pilih HoD</Label>
                      <Select value={r.hodKey ?? NONE} onValueChange={(v) => void saveHodKey(r.urutan, v ?? NONE)}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Belum dipilih" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>(belum dipilih)</SelectItem>
                          {hodOptions.map((h) => (
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
                {r.routing === "tetap" && (
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
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
