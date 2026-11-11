import type { Metadata } from "next";

import { gatewayFetch } from "@/lib/gateway";
import { DailySummaryPublik, type DsPublik } from "@/components/daily-summary/ds-publik";

export const dynamic = "force-dynamic";

// 308 — halaman detail Daily Summary, dibuka HOD dari tautan di grup HOD Squad (PUBLIK, tanpa login; middleware
// meloloskan /ds/). Data dimuat di server lewat API (x-service-token); token acak, berlaku 30 hari.
export const metadata: Metadata = {
  title: "Daily Summary — Wahana LifeLine",
  robots: { index: false, follow: false },
};

async function muat(token: string): Promise<DsPublik | null> {
  if (!/^[A-Za-z0-9_-]{22}$/.test(token)) return null;
  try {
    const res = await gatewayFetch(`/daily-summary-publik/${token}`);
    if (!res.ok) return null;
    return (await res.json()) as DsPublik;
  } catch {
    return null;
  }
}

export default async function DailySummaryPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await muat(token);
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900">
      <div className="mx-auto w-full max-w-2xl">
        {data ? (
          <DailySummaryPublik data={data} />
        ) : (
          <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
            <h1 className="text-lg font-semibold">Tautan tidak berlaku</h1>
            <p className="mt-2 text-sm text-slate-600">Tautan Daily Summary hanya berlaku 30 hari. Buka tautan terbaru di grup HOD Squad.</p>
          </div>
        )}
        <p className="mt-6 text-center text-xs text-slate-500">PT Wahana Lifeline · internal, jangan diteruskan ke luar tim.</p>
      </div>
    </main>
  );
}
