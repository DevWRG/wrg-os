"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Settings } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { AuditFindingsTable } from "./audit-findings-table";
import { AddAuditFindingButton } from "./add-audit-finding-button";
import { STATUS_LABEL, type AuditFinding } from "./audit-findings-types";

const STATUS_FILTERS = [["all", "Semua"], ...Object.entries(STATUS_LABEL)] as const;

export function AuditFindingsView({
  findings, totalRows, canManageConfig,
}: { findings: AuditFinding[]; totalRows: number; canManageConfig: boolean }) {
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filtered = useMemo(
    () => findings.filter((f) => statusFilter === "all" || f.status === statusFilter),
    [findings, statusFilter],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map(([k, lbl]) => (
            <Button key={k} size="sm" variant={statusFilter === k ? "default" : "outline"} aria-pressed={statusFilter === k} onClick={() => setStatusFilter(k)}>
              {lbl}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {canManageConfig && (
            <Button size="sm" variant="outline" render={<Link href="/audit-findings/config" />} nativeButton={false}>
              <Settings /> Config Chain
            </Button>
          )}
          <AddAuditFindingButton />
        </div>
      </div>

      {totalRows > findings.length && (
        <p className="text-muted-foreground text-sm">
          Menampilkan {findings.length} temuan terbaru dari {totalRows}. Filter status di atas hanya menyaring yang tampil.
        </p>
      )}

      <Card>
        <CardContent className="pt-6">
          {findings.length === 0 ? (
            <EmptyState title="Belum ada temuan" description="Catat temuan audit lewat tombol di atas." />
          ) : (
            <AuditFindingsTable findings={filtered} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
