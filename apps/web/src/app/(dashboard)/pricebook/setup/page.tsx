import Link from "next/link";
import { redirect } from "next/navigation";

import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canEditPricelistSetup, canPublishPricelist } from "@/lib/pricelist-access";
import { canEditHppKonversi, canViewHppKonversi } from "@/lib/hpp-konversi-access";
import { cn } from "@/lib/utils";
import { HppKonversiPanel } from "@/components/pricelist/hpp-konversi-panel";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import {
  PricebookSetupTable, type PricebookSetupRow, type PricebookSetupSummary,
} from "@/components/pricelist/pricebook-setup-table";

export const dynamic = "force-dynamic";

// Setup Harga — SATU-SATUNYA muka yang memuat HPP & margin, jadi menu sendiri dan
// gate-nya paling ketat: HoD Business / Purchasing (+ admin). HANDOVER §1/§9
// melarang HPP, margin, dan harga sub-dealer keluar ke sales.
//
// Sejak 1 Agt 2026 halaman ini FOKUS PRODUK KEAGENAN (keputusan user): sub-tab
// "Produk Accurate" (kalkulator tabel 043) dilepas. Tabel 043, endpoint /pricelist,
// dan importer-nya tetap ada — yang dilepas cuma mukanya, jadi kalau nanti
// dibutuhkan lagi tinggal dipasang kembali tanpa migrasi.
//
// Di sini HoD Business menyetel HPP · Price List · Diskon Maks per SKU keagenan
// lalu mem-publish-nya; yang published muncul di tab "Harga per Produk" pada menu
// Price Book yang dibuka AM.
//
// Route ini memakai feature key 'pricelist-setup' (lihat NavItem.feature di
// lib/nav.ts) supaya izin grup yang sudah ada dari menu "Pricelist Setup" lama
// tetap berlaku — kalau tidak, kuncinya berubah jadi 'pricebook-setup' dan semua
// grant lama harus dicentang ulang.
//
// redirect() dipakai, bukan render pesan "akses ditolak": halaman yang tetap
// dirender ikut mengirim payload RSC-nya.
//
// Tab "Konversi satuan HPP" (?tab=konversi, migrasi 309): HPP di sini per KEMASAN, qty faktur
// Accurate per satuan item — konversinya diisi di tab itu. Gate-nya sendiri
// (lib/hpp-konversi-access: Setup Harga + Finance), jadi Finance yang tak boleh mengedit
// harga hanya melihat tab konversi.
export default async function PricebookSetupPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const me = await sessionUser();
  const bolehHarga = canEditPricelistSetup(me);
  const bolehKonversi = canViewHppKonversi(me);
  if (!bolehHarga && !bolehKonversi) {
    redirect("/akses-ditolak?menu=Setup%20Harga");
  }
  const tab = !bolehHarga || (bolehKonversi && (await searchParams).tab === "konversi") ? "konversi" : "harga";

  async function getJson<T>(path: string): Promise<T | null> {
    try {
      const res = await gatewayFetch(path);
      return res.ok ? ((await res.json()) as T) : null;
    } catch {
      return null;
    }
  }

  const pb = tab === "harga"
    ? await getJson<{ rows: PricebookSetupRow[]; ringkas: PricebookSetupSummary }>("/pricebook/setup?limit=20000")
    : null;

  const tabs = [
    ...(bolehHarga ? [{ key: "harga", label: "Harga keagenan", href: "/pricebook/setup" }] : []),
    ...(bolehKonversi ? [{ key: "konversi", label: "Konversi satuan HPP", href: "/pricebook/setup?tab=konversi" }] : []),
  ];

  return (
    <>
      <PageHeader
        title="Setup Harga"
        description="Setel Harga Principal (HPP), Price List & Diskon Maks per SKU keagenan, lalu publikasikan agar tampil ke AM. Angka di halaman ini internal: jangan dibagikan ke sales."
      />
      {tabs.length > 1 && (
        <nav className="mb-4 flex flex-wrap gap-2" aria-label="Tab Setup Harga">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={t.href}
              aria-current={tab === t.key ? "page" : undefined}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm font-medium shadow-sm transition-colors",
                tab === t.key ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent",
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      )}
      {tab === "konversi" ? (
        <HppKonversiPanel canEdit={canEditHppKonversi(me)} />
      ) : !pb ? (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code> dan migrasi{" "}
          <code>073_pricebook_setup.sql</code> + <code>077_pricebook_setup_publish.sql</code> sudah diterapkan.
        </p>
      ) : (
        <div className="min-w-0">
          <Card>
            <CardContent className="pt-6">
              <PricebookSetupTable
                rows={pb.rows ?? null}
                ringkas={pb.ringkas ?? null}
                canPublish={canPublishPricelist(me)}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
