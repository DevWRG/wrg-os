import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canEditDocTracker, canViewDocTracker } from "@/lib/doc-tracker-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { DocTrackerView } from "@/components/doc-tracker/doc-tracker-view";
import { STATES, type DocState, type DocTrackerList } from "@/components/doc-tracker/types";
import { paramFilter, type DocQuery, type Saring } from "@/components/doc-tracker/query";

// Kolom urut = DOC_SORTS di apps/api repo/doc-tracker.ts.
const SORTS = ["so", "customer", "state", "umur", "peringatan", "tanggal", "total"];
const SARING: Saring[] = ["dikirim_belum_dibayar", "billing", "anomali"];
const PAGE_SIZES = [10, 25, 50, 100];
const DEFAULT_SIZE = 25;

export const dynamic = "force-dynamic";

// DOC Document Tracker — 7 state per Sales Order: Draft → Sent → Received → Executed → Billed → Paid → Closed.
// Dihitung dari data yang sudah ada (SO/SJ/BAST WA & Instalasi/faktur/Arsip); hanya checklist ttd manual dan tautan faktur
// manual yang dicatat. Kunci izin sendiri 'doc-tracker' (lib/doc-tracker-access.ts); mencatat = aksi edit.
export default async function DocTrackerPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; state?: string; saring?: string; sort?: string; dir?: string; page?: string; size?: string }>;
}) {
  const [sp, me] = await Promise.all([searchParams, sessionUser()]);
  if (!canViewDocTracker(me)) {
    return (
      <>
        <PageHeader title="Document Tracker" />
        <EmptyState title="Tidak punya akses" description="Fitur ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  // Mode server: state semua SO di jendela dihitung backend (funnel benar),
  // tabel hanya menerima satu halaman. Dulu backend memotong di 500 SO.
  const query: DocQuery = {
    q: (sp.q ?? "").trim(),
    state: (STATES as readonly string[]).includes(sp.state ?? "") ? (sp.state as DocState) : null,
    saring: SARING.includes(sp.saring as Saring) ? (sp.saring as Saring) : "semua",
    sort: SORTS.includes(sp.sort ?? "") ? sp.sort! : "tanggal",
    dir: sp.dir === "asc" ? "asc" : "desc",
    size: PAGE_SIZES.includes(Number(sp.size)) ? Number(sp.size) : DEFAULT_SIZE,
    page: Math.max(0, Math.trunc(Number(sp.page)) || 0),
  };
  const qs = paramFilter(query);
  qs.set("limit", String(query.size));
  qs.set("offset", String(query.page * query.size));
  let data: DocTrackerList | null = null;
  try {
    const r = await gatewayFetch(`/doc-tracker?${qs.toString()}`);
    if (r.ok) data = (await r.json()) as DocTrackerList;
  } catch {
    data = null;
  }

  return (
    <>
      <PageHeader
        title="Document Tracker"
        description="Rekap dokumen tiap transaksi — sudah ada atau belum — untuk menyatakan statusnya, dari order masuk sampai dibayar dan ditutup."
      />
      {!data
        ? <EmptyState title="Data tidak dapat dimuat" description="Backend tidak terjangkau atau migrasi belum diterapkan. Coba muat ulang beberapa saat lagi." />
        : <DocTrackerView data={data} canEdit={canEditDocTracker(me)} query={query} />}
    </>
  );
}
