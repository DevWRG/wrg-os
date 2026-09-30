"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExportButton } from "@/components/ui/export-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Selaras HODS di apps/api/src/hod-resolver.ts (duplikat sengaja, pola sama
// approval-requests/config/page.tsx).
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
const ALL = "__all__";

interface Row {
  id: number;
  kode: string;
  nama: string;
  dept: string | null;
  tanggal_lembur: string;
  estimasi_menit: number;
  uraian: string;
  status: "pending" | "approved" | "rejected";
  hod_key: string | null;
  approver_nama: string | null;
  notify_status: string | null;
  decided_by: string | null;
  decision_note: string | null;
}
interface Rule {
  id: number;
  dept: string | null;
  posisi_pattern: string | null;
  am_id: string | null;
  catatan: string | null;
  aktif: boolean;
}
interface Options {
  departments: { key: string; label: string }[];
  people: { am_id: string; nama: string; posisi: string | null }[];
}

const durasi = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} jam${m % 60 ? ` ${m % 60} menit` : ""}` : `${m} menit`);
const statusBadge = (s: Row["status"]) =>
  s === "approved" ? (
    <Badge>Disetujui</Badge>
  ) : s === "rejected" ? (
    <Badge variant="destructive">Ditolak</Badge>
  ) : (
    <Badge variant="secondary">Menunggu</Badge>
  );

export function OvertimeBoard({ isAdmin }: { isAdmin: boolean }) {
  const [tab, setTab] = useState<"pengajuan" | "aturan">("pengajuan");
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<string>(ALL);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [assign, setAssign] = useState<Record<number, string>>({});

  const [rules, setRules] = useState<Rule[]>([]);
  const [options, setOptions] = useState<Options>({ departments: [], people: [] });
  const [nDept, setNDept] = useState(ALL);
  const [nPosisi, setNPosisi] = useState("");
  const [nPerson, setNPerson] = useState(ALL);

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (status !== ALL) qs.set("status", status);
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    try {
      const res = await fetch(`/api/overtime?${qs}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal memuat");
      setRows(data.rows ?? []);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [status, from, to]);

  const loadRules = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await fetch("/api/overtime/rules", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal memuat aturan");
      setRules(data.rules ?? []);
      setOptions(data.options ?? { departments: [], people: [] });
    } catch (e) {
      setError(String(e));
    }
  }, [isAdmin]);

  // Inline IIFE (bukan `void load()` langsung) — hindari lint react-hooks
  // set-state-in-effect (pola sama approval-requests/config/page.tsx).
  useEffect(() => {
    let active = true;
    (async () => {
      if (active) await load();
    })();
    return () => {
      active = false;
    };
  }, [load]);
  useEffect(() => {
    let active = true;
    (async () => {
      if (active) await loadRules();
    })();
    return () => {
      active = false;
    };
  }, [loadRules]);

  async function post(url: string, body: unknown, id: number) {
    setBusy(id);
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal");
      setError(null);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function decide(r: Row, action: "approve" | "reject") {
    let note: string | undefined;
    if (action === "reject") {
      const n = window.prompt(`Alasan menolak ${r.kode} (opsional):`);
      if (n === null) return;
      note = n;
    } else if (!window.confirm(`Setujui ${r.kode} — ${r.nama}, ${durasi(r.estimasi_menit)}?`)) {
      return;
    }
    await post(`/api/overtime/${r.id}/decide`, { action, note }, r.id);
  }

  async function ruleCall(url: string, method: string, body?: unknown) {
    try {
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal");
      setError(null);
      await loadRules();
    } catch (e) {
      setError(String(e));
    }
  }

  const deptLabel = (k: string | null) => options.departments.find((d) => d.key === k)?.label ?? k;
  const personLabel = (id: string | null) => options.people.find((p) => p.am_id === id)?.nama ?? id;

  return (
    <div className="mt-4 space-y-4">
      <div className="flex gap-2">
        <Button size="sm" variant={tab === "pengajuan" ? "default" : "outline"} onClick={() => setTab("pengajuan")}>
          Pengajuan
        </Button>
        {isAdmin && (
          <Button size="sm" variant={tab === "aturan" ? "default" : "outline"} onClick={() => setTab("aturan")}>
            Aturan pengaju
          </Button>
        )}
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}

      {tab === "pengajuan" && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-40">
                <Label className="mb-1 block text-xs">Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v ?? ALL)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Semua</SelectItem>
                    <SelectItem value="pending">Menunggu</SelectItem>
                    <SelectItem value="approved">Disetujui</SelectItem>
                    <SelectItem value="rejected">Ditolak</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1 block text-xs">Dari tanggal</Label>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div>
                <Label className="mb-1 block text-xs">Sampai</Label>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
              <ExportButton
                filename="lembur"
                data={rows}
                columns={[
                  { header: "Kode", value: (r: Row) => r.kode },
                  { header: "Tanggal", value: (r: Row) => r.tanggal_lembur },
                  { header: "Nama", value: (r: Row) => r.nama },
                  { header: "Divisi", value: (r: Row) => r.dept },
                  { header: "Estimasi (menit)", value: (r: Row) => r.estimasi_menit },
                  { header: "Pekerjaan", value: (r: Row) => r.uraian },
                  { header: "Status", value: (r: Row) => r.status },
                  { header: "Diputus oleh", value: (r: Row) => r.decided_by },
                  { header: "Catatan", value: (r: Row) => r.decision_note },
                ]}
              />
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kode</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Pengaju</TableHead>
                  <TableHead>Estimasi</TableHead>
                  <TableHead>Pekerjaan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-muted-foreground text-center text-sm">
                      Belum ada pengajuan.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.kode}</TableCell>
                    <TableCell>{r.tanggal_lembur}</TableCell>
                    <TableCell>
                      {r.nama}
                      <div className="text-muted-foreground text-xs">{r.dept ?? "-"}</div>
                    </TableCell>
                    <TableCell>{durasi(r.estimasi_menit)}</TableCell>
                    <TableCell className="max-w-xs whitespace-normal">{r.uraian}</TableCell>
                    <TableCell>
                      {statusBadge(r.status)}
                      {r.status !== "pending" && (
                        <div className="text-muted-foreground text-xs">
                          {r.decided_by}
                          {r.decision_note ? ` — ${r.decision_note}` : ""}
                        </div>
                      )}
                      {r.status === "pending" && (
                        <div className="text-muted-foreground text-xs">
                          {r.hod_key ? `HoD: ${r.approver_nama ?? r.hod_key}` : "HoD belum ditetapkan"}
                          {r.notify_status && r.notify_status !== "terkirim" ? ` · ${r.notify_status}` : ""}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.status === "pending" && (
                        <div className="flex flex-col gap-2">
                          <div className="flex gap-2">
                            <Button size="sm" disabled={busy === r.id} onClick={() => void decide(r, "approve")}>
                              Setujui
                            </Button>
                            <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => void decide(r, "reject")}>
                              Tolak
                            </Button>
                          </div>
                          {isAdmin && (
                            <div className="flex items-center gap-2">
                              <Select
                                value={assign[r.id] ?? r.hod_key ?? ""}
                                onValueChange={(v) => setAssign((p) => ({ ...p, [r.id]: v ?? "" }))}
                              >
                                <SelectTrigger className="w-44">
                                  <SelectValue placeholder="Tetapkan HoD" />
                                </SelectTrigger>
                                <SelectContent>
                                  {HOD_OPTIONS.map((h) => (
                                    <SelectItem key={h.key} value={h.key}>
                                      {h.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy === r.id || !(assign[r.id] ?? r.hod_key)}
                                onClick={() => void post(`/api/overtime/${r.id}/assign-hod`, { hodKey: assign[r.id] ?? r.hod_key }, r.id)}
                              >
                                Tetapkan &amp; kirim
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {tab === "aturan" && isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Siapa boleh mengajukan lembur</CardTitle>
            <p className="text-muted-foreground text-xs">
              Pengaju lolos bila ada aturan aktif yang cocok. Divisi + pola posisi digabung (keduanya harus cocok bila diisi);
              &quot;orang&quot; adalah pengecualian per individu. Tanpa aturan apa pun, tak ada yang bisa mengajukan.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-44">
                <Label className="mb-1 block text-xs">Divisi</Label>
                <Select value={nDept} onValueChange={(v) => setNDept(v ?? ALL)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>(semua divisi)</SelectItem>
                    {options.departments.map((d) => (
                      <SelectItem key={d.key} value={d.key}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-44">
                <Label className="mb-1 block text-xs">Pola posisi (mengandung kata)</Label>
                <Input value={nPosisi} onChange={(e) => setNPosisi(e.target.value)} placeholder="mis. admin" />
              </div>
              <div className="min-w-44">
                <Label className="mb-1 block text-xs">Atau orang tertentu</Label>
                <Select value={nPerson} onValueChange={(v) => setNPerson(v ?? ALL)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>(tidak dipakai)</SelectItem>
                    {options.people.map((p) => (
                      <SelectItem key={p.am_id} value={p.am_id}>
                        {p.nama}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="sm"
                onClick={async () => {
                  await ruleCall("/api/overtime/rules", "POST", {
                    dept: nDept === ALL ? null : nDept,
                    posisi_pattern: nPosisi.trim() || null,
                    am_id: nPerson === ALL ? null : nPerson,
                  });
                  setNDept(ALL);
                  setNPosisi("");
                  setNPerson(ALL);
                }}
              >
                Tambah aturan
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Divisi</TableHead>
                  <TableHead>Pola posisi</TableHead>
                  <TableHead>Orang</TableHead>
                  <TableHead>Aktif</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground text-center text-sm">
                      Belum ada aturan — tak ada yang bisa mengajukan.
                    </TableCell>
                  </TableRow>
                )}
                {rules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{deptLabel(r.dept) ?? "(semua)"}</TableCell>
                    <TableCell>{r.posisi_pattern ?? "-"}</TableCell>
                    <TableCell>{r.am_id ? personLabel(r.am_id) : "-"}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant={r.aktif ? "default" : "outline"}
                        onClick={() => void ruleCall(`/api/overtime/rules/${r.id}`, "PATCH", { aktif: !r.aktif })}
                      >
                        {r.aktif ? "Aktif" : "Nonaktif"}
                      </Button>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (window.confirm("Hapus aturan ini?")) void ruleCall(`/api/overtime/rules/${r.id}`, "DELETE");
                        }}
                      >
                        Hapus
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
