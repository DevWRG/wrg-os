import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canManageAuditFindingChainConfig } from "@/lib/audit-finding-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { AuditFindingsView } from "@/components/audit-findings/audit-findings-view";
import type { AuditFinding } from "@/components/audit-findings/audit-findings-types";

export const dynamic = "force-dynamic";

async function getFindings(): Promise<AuditFinding[]> {
  try {
    const res = await gatewayFetch("/audit-findings");
    if (!res.ok) return [];
    const data = (await res.json()) as { findings: AuditFinding[] };
    return data.findings ?? [];
  } catch {
    return [];
  }
}

export default async function AuditFindingsPage() {
  const [findings, me] = await Promise.all([getFindings(), sessionUser()]);
  return (
    <>
      <PageHeader
        title="Audit Findings"
        description="Komite Audit Findings Tracker (F60) — per-finding status + control linkage, chain approval penutupan berjenjang (2-5 tahap, custom per grup)."
      />
      <AuditFindingsView findings={findings} canManageConfig={canManageAuditFindingChainConfig(me)} />
    </>
  );
}
