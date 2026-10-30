import type { Metadata } from "next";

import { gatewayFetch } from "@/lib/gateway";
import { FormDaftarPameran, type InfoPameran } from "@/components/pameran/form-daftar";

export const dynamic = "force-dynamic";

// F173 — form registrasi pengunjung pameran, dibuka dari QR di booth (PUBLIK, tanpa login;
// middleware meloloskan /daftar/). Info acara dimuat di server; kirim isian lewat
// /api/publik/pameran/<slug>/daftar.
export const metadata: Metadata = {
  title: "Registrasi Pengunjung — Wahana LifeLine",
  robots: { index: false, follow: false },
};

async function muatInfo(slug: string): Promise<InfoPameran | null> {
  if (!/^[a-z0-9][a-z0-9-]{2,59}$/.test(slug)) return null;
  try {
    const res = await gatewayFetch(`/pameran-publik/${slug}`);
    if (!res.ok) return null;
    return (await res.json()) as InfoPameran;
  } catch {
    return null;
  }
}

export default async function DaftarPameranPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const info = await muatInfo(slug);
  return (
    <main className="min-h-screen bg-gradient-to-b from-[#0a8a9e] via-[#0ca6bd] to-[#2bd4a8] px-4 py-8">
      <div className="mx-auto w-full max-w-md">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/wahana-lifeline-white.png" alt="Wahana LifeLine" className="mx-auto mb-6 h-9 w-auto drop-shadow" />
        <div className="rounded-2xl bg-white p-6 text-slate-900 shadow-xl">
          {info ? (
            <FormDaftarPameran slug={slug} info={info} />
          ) : (
            <div className="py-6 text-center">
              <h1 className="text-lg font-semibold">Pameran tidak ditemukan</h1>
              <p className="mt-2 text-sm text-slate-600">Tautan atau QR yang Anda buka tidak berlaku. Silakan tanyakan petugas di booth.</p>
            </div>
          )}
        </div>
        <p className="mt-6 text-center text-xs text-white/80">PT Wahana Lifeline · data Anda hanya dipakai untuk undian dan informasi produk.</p>
      </div>
    </main>
  );
}
