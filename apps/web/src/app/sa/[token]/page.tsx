import type { Metadata } from "next";

import { gatewayFetch } from "@/lib/gateway";
import { AreaInfografis, type InfografisData } from "@/components/sales-analytics/area-infografis";

export const dynamic = "force-dynamic";

// 310 — infografis Sales Area Performance, dibuka grup Koord HoD dari tautan ringkasan WA (PUBLIK, tanpa login;
// middleware meloloskan /sa/). Data dimuat di server lewat API (x-service-token); token acak per tanggal, berlaku
// 2 hari (keputusan user 12 Nov 2026). Versi ber-login: /sales-analytics/area.
export const metadata: Metadata = {
  title: "Sales Area Performance — Wahana LifeLine",
  robots: { index: false, follow: false },
};

async function muat(token: string): Promise<InfografisData | null> {
  if (!/^[A-Za-z0-9_-]{22}$/.test(token)) return null;
  try {
    const res = await gatewayFetch(`/sales-area-publik/${token}`);
    if (!res.ok) return null;
    return (await res.json()) as InfografisData;
  } catch {
    return null;
  }
}

export default async function SalesAreaPublikPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await muat(token);
  const diperbarui = data
    ? new Date(data.generated_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" })
    : "";
  return (
    <main className="bg-background min-h-screen px-4 py-6">
      <div className="mx-auto w-full max-w-7xl space-y-4">
        {data ? (
          <>
            <div>
              <h1 className="text-2xl font-semibold">Sales Area Performance</h1>
              <p className="text-muted-foreground text-sm">
                Per {data.performance.as_of} · omzet netto tanpa PPN dari faktur Accurate · diperbarui {diperbarui}
              </p>
            </div>
            <AreaInfografis data={data} />
          </>
        ) : (
          <div className="bg-card mx-auto max-w-xl rounded-2xl p-6 text-center shadow-sm">
            <h1 className="text-lg font-semibold">Tautan tidak berlaku</h1>
            <p className="text-muted-foreground mt-2 text-sm">
              Tautan Sales Area hanya berlaku 2 hari. Buka tautan terbaru di grup, atau lihat menu Sales Analytics di WRG OS.
            </p>
          </div>
        )}
        <p className="text-muted-foreground text-center text-xs">PT Wahana Lifeline · internal, jangan diteruskan ke luar tim.</p>
      </div>
    </main>
  );
}
