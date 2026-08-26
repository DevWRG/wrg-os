import Link from "next/link";

import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/dashboard/page-header";
import { AddVisitSheet, type AmOption } from "@/components/crm/add-visit-sheet";
import {
  TimelinessCard,
  VisitTargetTable,
  WeeklyTargetCard,
  type TimelinessKpi,
  type VisitTargetKpi,
} from "@/components/crm/visit-target-panel";
import { VisitsTable } from "@/components/tables/visits-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

interface VisitItem {
  id: string;
  am_id: string;
  nama: string | null;
  customer_name: string | null;
  photo_url: string | null;
  visit_lat: number | null;
  visit_lon: number | null;
  visit_timestamp: string | null;
  visit_date: string | null;
  geo_status: string;
  tujuan: string | null;
  goal: string | null;
  catatan: string | null;
  activity_type: string | null;
  account_id: number | null;
  created_at: string;
}
interface VisitResponse {
  /** baris yang dikirim di halaman ini. */
  count: number;
  /** baris yang COCOK FILTER di backend — inilah angka yang dipakai footer tabel. */
  total_rows: number;
  limit: number;
  offset: number;
  visits: VisitItem[];
}
interface RosterResponse {
  count: number;
  users: { am_id: string; nama: string | null; panggilan: string | null; cabang: string | null }[];
}
interface VisitSummary {
  total: number;
  by_status: Record<string, number>;
  flagged: number;
}
interface VisitKpi {
  timeliness: TimelinessKpi;
  targets: VisitTargetKpi;
}

const FILTERS: { key: string; label: string }[] = [
  { key: "", label: "Semua" },
  { key: "ok", label: "Valid" },
  { key: "no_geo", label: "Tanpa GPS" },
  { key: "date_mismatch", label: "Tanggal tak cocok" },
  { key: "out_of_bounds", label: "Di luar Indonesia" },
];

// x-user-id → backend menerapkan row-level scope (AM = kunjungan sendiri, HoD =
// cabang tim, admin = semua). Tanpa sesi (auth mati/dev) header tak dikirim →
// backend pakai FULL_SCOPE seperti perilaku lama.
async function getJson<T>(path: string, userId?: string): Promise<T | null> {
  try {
    const res = await gatewayFetch(`${path}`, userId ? { headers: { "x-user-id": userId } } : undefined);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// Kolom urut yang diterima backend (VISIT_SORTS di apps/api repo/visit.ts).
// Divalidasi di sini juga supaya ?sort= karangan tidak diteruskan bulat-bulat.
const SORTS = ["tanggal", "am", "customer", "tipe", "geo", "dibuat"];
const PAGE_SIZES = [10, 25, 50, 100];
const DEFAULT_SIZE = 25;

export default async function VisitsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    q?: string;
    from?: string;
    to?: string;
    sort?: string;
    dir?: string;
    page?: string;
    size?: string;
  }>;
}) {
  const sp = await searchParams;
  const status = sp.status;
  const active = status && FILTERS.some((f) => f.key === status) ? status : "";

  // Satu halaman saja yang diambil — tabel tak lagi menerima 1000 baris lalu
  // menyaringnya sendiri. Konsekuensinya search/sort/rentang tanggal HARUS ikut
  // ke backend, karena tak ada lagi baris cadangan di klien untuk disaring.
  const q = (sp.q ?? "").trim();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : "";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to! : "";
  const sort = SORTS.includes(sp.sort ?? "") ? sp.sort! : "tanggal";
  const dir: "asc" | "desc" = sp.dir === "asc" ? "asc" : "desc";
  const size = PAGE_SIZES.includes(Number(sp.size)) ? Number(sp.size) : DEFAULT_SIZE;
  const page = Math.max(0, Math.trunc(Number(sp.page)) || 0);

  const listQs = new URLSearchParams();
  if (active) listQs.set("status", active);
  if (q) listQs.set("q", q);
  if (from) listQs.set("from", from);
  if (to) listQs.set("to", to);
  listQs.set("sort", sort);
  listQs.set("dir", dir);
  listQs.set("limit", String(size));
  listQs.set("offset", String(page * size));

  const me = await sessionUser();
  // Sembunyikan tombol "Tambah kunjungan" HANYA dari karyawan sales/AM (is_am dari
  // /auth/me = scope.amOnly). Peran lain (admin/HoD/direktur/dll) tetap lihat.
  // Tanpa sesi (auth mati/dev) is_am undefined → tombol tetap tampil (non-breaking).
  const canAddVisit = !me?.is_am;
  const [summary, list, kpi, roster] = await Promise.all([
    getJson<VisitSummary>("/visits/summary", me?.id),
    getJson<VisitResponse>(`/visits?${listQs.toString()}`, me?.id),
    getJson<VisitKpi>("/visits/kpi", me?.id),
    // Roster AM untuk dropdown form — am_id nyata = user_id legacy, jangan
    // diketik manual. Hanya diambil kalau tombolnya memang tampil.
    canAddVisit ? getJson<RosterResponse>("/master/users?role=AM&aktif=true", me?.id) : null,
  ]);
  // Yang menentukan "ada hasil / tidak" adalah total_rows (seluruh yang cocok
  // filter), bukan panjang halaman: halaman terakhir yang kebetulan kosong
  // bukan berarti filternya nihil.
  const matched = list?.total_rows ?? 0;

  // ?page= di luar jangkauan (URL diketik tangan / di-bookmark saat hasilnya
  // masih banyak) → ambil halaman terakhir yang valid. Tanpa ini tabelnya
  // kosong tapi footernya tetap menulis "120 baris": tampilan yang persis
  // sejenis dengan bug yang sedang diperbaiki. Permintaan kedua ini hanya
  // terjadi pada kasus di luar jangkauan, bukan pada pemakaian normal.
  const lastPage = matched > 0 ? Math.ceil(matched / size) - 1 : 0;
  let pageAktif = page;
  let list2 = list;
  if (list && matched > 0 && list.visits.length === 0 && page > lastPage) {
    pageAktif = lastPage;
    listQs.set("offset", String(lastPage * size));
    list2 = (await getJson<VisitResponse>(`/visits?${listQs.toString()}`, me?.id)) ?? list;
  }
  const visits = list2?.visits ?? null;
  const amOptions: AmOption[] = (roster?.users ?? []).map((u) => ({
    am_id: u.am_id,
    label: [u.panggilan || u.nama || u.am_id, u.cabang].filter(Boolean).join(" · "),
  }));

  const total = summary?.total ?? 0;
  const ok = summary?.by_status?.ok ?? 0;
  const noGeo = summary?.by_status?.no_geo ?? 0;
  const review = (summary?.by_status?.date_mismatch ?? 0) + (summary?.by_status?.out_of_bounds ?? 0);

  return (
    <>
      <PageHeader
        title="Visits"
        description="Kunjungan AM dengan geotag + foto (port visit). Geo divalidasi terhadap bbox Indonesia."
        action={canAddVisit ? <AddVisitSheet amOptions={amOptions} /> : undefined}
      />

      {!summary ? (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code>.
        </p>
      ) : total === 0 ? (
        <p className="text-muted-foreground">
          Belum ada kunjungan. Catat via <code>POST /visits</code>.
        </p>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-muted-foreground text-sm font-medium">Total kunjungan</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-semibold">{total}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-muted-foreground text-sm font-medium">Geo valid</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-semibold">{ok}</div>
                <p className="text-muted-foreground text-xs">{total > 0 ? Math.round((ok / total) * 100) : 0}% dari total</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-muted-foreground text-sm font-medium">Tanpa GPS</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-semibold">{noGeo}</div>
                <p className="text-muted-foreground text-xs">tak ada koordinat</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-muted-foreground text-sm font-medium">Perlu ditinjau</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-semibold">{review}</div>
                <p className="text-muted-foreground text-xs">tanggal tak cocok / luar bbox</p>
              </CardContent>
            </Card>
            {kpi ? <TimelinessCard kpi={kpi.timeliness} /> : null}
            {kpi ? <WeeklyTargetCard kpi={kpi.targets} /> : null}
          </div>

          {kpi ? <VisitTargetTable kpi={kpi.targets} /> : null}

          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => {
              const count = f.key === "" ? total : (summary.by_status?.[f.key] ?? 0);
              // Pindah tab mempertahankan pencarian/rentang/urutan dan hanya
              // me-reset halaman — pindah ke "Valid" lalu mendarat di halaman 12
              // yang kosong itu terasa seperti data hilang.
              const tabQs = new URLSearchParams();
              if (f.key) tabQs.set("status", f.key);
              if (q) tabQs.set("q", q);
              if (from) tabQs.set("from", from);
              if (to) tabQs.set("to", to);
              if (sort !== "tanggal") tabQs.set("sort", sort);
              if (dir !== "desc") tabQs.set("dir", dir);
              if (size !== DEFAULT_SIZE) tabQs.set("size", String(size));
              return (
                <Link
                  key={f.key || "all"}
                  href={tabQs.toString() ? `/visits?${tabQs.toString()}` : "/visits"}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-sm transition-colors",
                    active === f.key
                      ? "border-primary bg-primary-soft text-primary font-medium"
                      : "border-border bg-card text-foreground shadow-[var(--shadow-card)] hover:border-primary/40 hover:bg-muted",
                  )}
                >
                  {f.label}
                  <span className={cn("text-xs tabular-nums", active === f.key ? "opacity-80" : "text-muted-foreground")}>{count}</span>
                </Link>
              );
            })}
          </div>

          <Card>
            <CardContent className="pt-6">
              {!visits ? (
                <p className="text-muted-foreground">Gagal memuat daftar kunjungan.</p>
              ) : matched === 0 ? (
                <p className="text-muted-foreground">Tidak ada kunjungan untuk filter ini.</p>
              ) : (
                <VisitsTable
                  visits={visits}
                  totalRows={matched}
                  query={{ q, from, to, sort, dir, page: pageAktif, size }}
                />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
