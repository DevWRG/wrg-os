"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SkeletonCardGrid } from "@/components/ui/loading";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useHodOptions } from "@/components/watchpoint/hod-options";
import { KATEGORI_OPTIONS, WILAYAH_OPTIONS } from "@/lib/approval-routing";

const NONE = "__none__";

interface ChainRow {
  jenis: string;
  urutan: number;
  label: string;
  // hod_pengaju = HoD yang dibawa tiap permintaan; grup = anggota grup akses (migrasi 247).
  targetType: "hod" | "direktur" | "hod_pengaju" | "grup";
  hodKey: string | null;
  groupKey: string | null;
  aktif: boolean;
  waNumberOverride: string | null;
  catatan: string | null;
  // Migrasi 190 (#1071): tahap yang orangnya dipilih per atribut request.
  routing: "tetap" | "wilayah" | "kategori";
  hodKeyMap: Record<string, string> | null;
}

interface AlurRow {
  jenis: string;
  label: string;
  slaJam: number | null;
  eskalasi: boolean;
  catatan: string | null;
}

function opsiPeta(routing: ChainRow["routing"]) {
  return routing === "wilayah" ? WILAYAH_OPTIONS : routing === "kategori" ? KATEGORI_OPTIONS : [];
}

async function ambilAlur(): Promise<{ rows: AlurRow[]; grup: { key: string; name: string }[] }> {
  const res = await fetch("/api/approval-requests/config/alur", { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "gagal memuat alur");
  return { rows: data.rows ?? [], grup: data.grup ?? [] };
}

async function ambilChain(jenis: string): Promise<ChainRow[]> {
  const res = await fetch(`/api/approval-requests/config/chain?jenis=${encodeURIComponent(jenis)}`, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "gagal memuat config");
  return data.rows ?? [];
}

export default function ApprovalConfigPage() {
  const { hods: hodOptions } = useHodOptions();
  const [alur, setAlur] = useState<AlurRow[]>([]);
  const [grup, setGrup] = useState<{ key: string; name: string }[]>([]);
  const [jenis, setJenis] = useState("pengadaan");
  const [rows, setRows] = useState<ChainRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<number | null>(null);
  const [overrideDrafts, setOverrideDrafts] = useState<Record<number, string>>({});
  const [slaDraft, setSlaDraft] = useState("");
  const [savingAlur, setSavingAlur] = useState(false);

  const alurNow = alur.find((a) => a.jenis === jenis) ?? null;

  const terapkan = useCallback(
    (a: { rows: AlurRow[]; grup: { key: string; name: string }[] }, c: ChainRow[]) => {
      setAlur(a.rows);
      setGrup(a.grup);
      setRows(c);
      setOverrideDrafts(Object.fromEntries(c.map((r) => [r.urutan, r.waNumberOverride ?? ""])));
      const now = a.rows.find((x) => x.jenis === jenis);
      setSlaDraft(now?.slaJam != null ? String(now.slaJam) : "");
    },
    [jenis],
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const [a, c] = await Promise.all([ambilAlur(), ambilChain(jenis)]);
      terapkan(a, c);
    } catch (e) {
      setError(String(e));
    }
  }, [jenis, terapkan]);

  // Inline IIFE (bukan `void load()` langsung) — hindari lint react-hooks
  // set-state-in-effect (pola sama hitl/calendar page).
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [a, c] = await Promise.all([ambilAlur(), ambilChain(jenis)]);
        if (active) terapkan(a, c);
      } catch (e) {
        if (active) setError(String(e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [jenis, terapkan]);

  async function patchTahap(urutan: number, patch: Record<string, unknown>) {
    setSaving(urutan);
    try {
      const res = await fetch(`/api/approval-requests/config/chain/${urutan}?jenis=${encodeURIComponent(jenis)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
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

  async function saveAlur(patch: { slaJam?: number | null; eskalasi?: boolean }) {
    setSavingAlur(true);
    try {
      const res = await fetch(`/api/approval-requests/config/alur/${encodeURIComponent(jenis)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal simpan");
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingAlur(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Setup Alur Approval</h1>
        <p className="text-muted-foreground">
          F11 — tiap alur punya urutan tahap & SLA sendiri. Approver kosong = belum dikonfigurasi, permintaan
          tertahan (tidak error) sampai diisi.{" "}
          <Link href="/approval-requests" className="text-primary underline">
            Kembali ke Approval Requests
          </Link>
        </p>
      </div>

      <div className="max-w-xs">
        <Label className="mb-1 block text-xs">Alur</Label>
        <Select value={jenis} onValueChange={(v) => v && setJenis(v)}>
          <SelectTrigger className="w-full">
            <SelectValue>{(v: string) => alur.find((a) => a.jenis === v)?.label ?? v}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {alur.map((a) => (
              <SelectItem key={a.jenis} value={a.jenis}>
                {a.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {alurNow && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">SLA alur {alurNow.label}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {alurNow.catatan && <p className="text-muted-foreground text-xs">{alurNow.catatan}</p>}
            <p className="text-muted-foreground text-xs">
              Dihitung per tahap sejak notifikasinya terkirim. Lewat batas → pengingat WA ke approver; lewat 2× batas →
              eskalasi ke Direktur dan kabar ke pengaju. Pengiriman hanya di jam kerja (job <code>approval-sla</code>).
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-40">
                <Label className="mb-1 block text-xs">Batas per tahap (jam)</Label>
                <Input
                  type="number"
                  min={1}
                  max={720}
                  value={slaDraft}
                  onChange={(e) => setSlaDraft(e.target.value)}
                  placeholder="kosong = tanpa SLA"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={savingAlur}
                onClick={() => void saveAlur({ slaJam: slaDraft.trim() ? Number(slaDraft) : null })}
              >
                Simpan
              </Button>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={alurNow.eskalasi}
                  disabled={savingAlur}
                  onCheckedChange={(v: boolean) => void saveAlur({ eskalasi: v })}
                />
                Eskalasi ke Direktur
              </label>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <SkeletonCardGrid count={3} className="gap-3 md:grid-cols-1" />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.urutan} className={r.aktif ? "" : "opacity-60"}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">
                  Tahap {r.urutan} — {r.label}
                </CardTitle>
                <label className="flex items-center gap-2 text-xs">
                  <Switch
                    checked={r.aktif}
                    disabled={saving === r.urutan}
                    onCheckedChange={(v: boolean) => void patchTahap(r.urutan, { aktif: v })}
                  />
                  {r.aktif ? "Aktif" : "Nonaktif — dilewati untuk permintaan baru"}
                </label>
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
                      <div key={o.value} className="min-w-56 max-w-xs">
                        <Label className="mb-1 block text-xs">{o.label.split(" — ")[0]}</Label>
                        <Select
                          value={r.hodKeyMap?.[o.value] ?? NONE}
                          onValueChange={(v) =>
                            void patchTahap(r.urutan, { hodKeyMap: { [o.value]: !v || v === NONE ? null : v } })
                          }
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
                    ))}
                  </div>
                ) : r.targetType === "hod" ? (
                  <div className="min-w-56 max-w-xs">
                    <Label className="mb-1 block text-xs">Pilih HoD</Label>
                    <Select
                      value={r.hodKey ?? NONE}
                      onValueChange={(v) => void patchTahap(r.urutan, { hodKey: !v || v === NONE ? null : v })}
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
                ) : r.targetType === "grup" ? (
                  <div className="min-w-56 max-w-xs">
                    <Label className="mb-1 block text-xs">Grup akses — semua anggotanya dinotif, satu cukup memutus</Label>
                    <Select
                      value={r.groupKey ?? NONE}
                      onValueChange={(v) => void patchTahap(r.urutan, { groupKey: !v || v === NONE ? null : v })}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          {(v: string) => (v === NONE ? "Belum dipilih" : (grup.find((g) => g.key === v)?.name ?? v))}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>(belum dipilih)</SelectItem>
                        {grup.map((g) => (
                          <SelectItem key={g.key} value={g.key}>
                            {g.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : r.targetType === "hod_pengaju" ? (
                  <p className="text-sm">
                    HoD ditentukan oleh tiap permintaan (mis. HoD divisi pengaju) — tidak diatur di sini.
                  </p>
                ) : (
                  <p className="text-sm">
                    Otomatis resolve ke akun dashboard dengan role <code>direktur</code>.
                  </p>
                )}
                {((r.targetType === "hod" && r.routing === "tetap") || r.targetType === "direktur") && (
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
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={saving === r.urutan}
                      onClick={() =>
                        void patchTahap(r.urutan, { waNumberOverride: overrideDrafts[r.urutan]?.trim() || null })
                      }
                    >
                      Simpan
                    </Button>
                  </div>
                )}
                {saving === r.urutan && <span className="text-muted-foreground text-xs">menyimpan…</span>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
