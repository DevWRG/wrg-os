"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AccessGroupOption, ChainConfigRow } from "@/components/audit-findings/audit-findings-types";

const NONE = "__none__";

export default function AuditFindingChainConfigPage() {
  const [config, setConfig] = useState<ChainConfigRow[]>([]);
  const [groups, setGroups] = useState<AccessGroupOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingUrutan, setSavingUrutan] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [cfgRes, groupsRes] = await Promise.all([
        fetch("/api/audit-findings/chain-config"),
        fetch("/api/audit-findings/access-groups"),
      ]);
      const cfg = await cfgRes.json();
      const groupsData = await groupsRes.json();
      if (!cfgRes.ok) throw new Error(cfg.error ?? "gagal memuat config");
      if (!groupsRes.ok) throw new Error(groupsData.error ?? "gagal memuat daftar grup");
      setConfig(cfg.config ?? []);
      setGroups(groupsData.groups ?? []);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() men-setState saat fetch; disengaja (sekali saat mount).
    void load();
  }, []);

  async function save(urutan: number, patch: { accessGroupId?: number | null; enabled?: boolean }) {
    setSavingUrutan(urutan);
    setError(null);
    try {
      const res = await fetch(`/api/audit-findings/chain-config/${urutan}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const d = await res.json();
      if (!res.ok || d.ok === false) throw new Error(d.error ?? "gagal menyimpan");
      await load();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setSavingUrutan(null);
    }
  }

  const enabledCount = config.filter((c) => c.enabled).length;

  return (
    <>
      <PageHeader
        title="Config Chain Approval — Audit Findings"
        description="Atur berapa tahap aktif (2-5) & grup penanggung jawab tiap tahap. Anggota grup dikelola lewat menu Akses Grup — perubahan anggota otomatis berlaku, tanpa perlu ubah config ini."
        action={
          <Button size="sm" variant="outline" render={<Link href="/audit-findings" />} nativeButton={false}>
            <ArrowLeft /> Kembali
          </Button>
        }
      />
      <Card>
        <CardContent className="pt-6 space-y-3">
          {loading && <p className="text-muted-foreground text-sm">Memuat…</p>}
          {!loading && (
            <>
              <p className="text-sm">
                Tahap aktif saat ini: <span className="font-medium">{enabledCount}</span> dari 5. Minimal 2 tahap harus
                aktif dan sudah punya grup sebelum finding bisa diajukan penutupan.
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Urutan</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead>Grup Penanggung Jawab</TableHead>
                    <TableHead>Aktif</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {config.map((c) => (
                    <TableRow key={c.urutan}>
                      <TableCell>{c.urutan}</TableCell>
                      <TableCell>{c.label}</TableCell>
                      <TableCell>
                        <Select
                          value={c.accessGroupId != null ? String(c.accessGroupId) : NONE}
                          onValueChange={(v) => save(c.urutan, { accessGroupId: v === NONE ? null : Number(v) })}
                        >
                          <SelectTrigger className="w-56">
                            <SelectValue placeholder="Pilih grup">
                              {() => (c.accessGroupId != null ? (c.accessGroupName ?? String(c.accessGroupId)) : "— belum diatur —")}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>— belum diatur —</SelectItem>
                            {groups.map((g) => (
                              <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={c.enabled}
                          disabled={savingUrutan === c.urutan}
                          onCheckedChange={(v: boolean) => save(c.urutan, { enabled: v })}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
          {error && <p className="text-destructive text-sm">{error}</p>}
        </CardContent>
      </Card>
    </>
  );
}
