import { redirect } from "next/navigation";

import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canEditPricelistSetup, canPublishPricelist } from "@/lib/pricelist-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { PricelistSetupTabs } from "@/components/pricelist/setup-tabs";
import type {
  PricebookSetupRow, PricebookSetupSummary,
} from "@/components/pricelist/pricebook-setup-table";
import type { ProductOption } from "@/components/pricelist/pricelist-form-sheet";
import type { PricelistRow } from "@/lib/pricelist";

export const dynamic = "force-dynamic";

// Setup Harga — SATU-SATUNYA muka yang memuat HPP & margin, jadi menu sendiri dan
// gate-nya paling ketat: HoD Business / Purchasing (+ admin). HANDOVER §1/§9
// melarang HPP, margin, dan harga sub-dealer keluar ke sales.
//
// Isinya dua sub-tab (lihat components/pricelist/setup-tabs.tsx):
//   • Produk Accurate  — kalkulator HPP→margin→diskon→insentif (tabel 043), + publish
//   • Price Book keagenan — lapisan kroscek HPP di atas snapshot Direktur (073)
//
// Route ini memakai feature key 'pricelist-setup' (lihat NavItem.feature di
// lib/nav.ts) supaya izin grup yang sudah ada dari menu "Pricelist Setup" lama
// tetap berlaku — kalau tidak, kuncinya berubah jadi 'pricebook-setup' dan semua
// grant lama harus dicentang ulang.
//
// redirect() dipakai, bukan render pesan "akses ditolak": halaman yang tetap
// dirender ikut mengirim payload RSC-nya.
export default async function PricebookSetupPage() {
  const me = await sessionUser();
  if (!canEditPricelistSetup(me)) {
    redirect("/akses-ditolak?menu=Setup%20Harga");
  }

  async function getJson<T>(path: string): Promise<T | null> {
    try {
      const res = await gatewayFetch(path);
      return res.ok ? ((await res.json()) as T) : null;
    } catch {
      return null;
    }
  }

  const [pl, prod, pb] = await Promise.all([
    getJson<{ rows: PricelistRow[] }>("/pricelist"),
    getJson<{ rows: { id: string | number; no: string | null; name: string | null }[] }>(
      "/accurate/items?limit=10000"),
    getJson<{ rows: PricebookSetupRow[]; ringkas: PricebookSetupSummary }>("/pricebook/setup"),
  ]);
  const products: ProductOption[] = (prod?.rows ?? []).map((p) => ({
    id: String(p.id), no: p.no, name: p.name,
  }));

  return (
    <>
      <PageHeader
        title="Setup Harga"
        description="Harga Principal (HPP), margin, diskon, alokasi insentif & konfirmasi area untuk produk Accurate — plus price book keagenan (harga final Direktur + HPP hasil kroscek). Angka di halaman ini internal: jangan dibagikan ke sales."
      />
      {!pl ? (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code> dan migrasi{" "}
          <code>043_pricelist.sql</code> sudah diterapkan.
        </p>
      ) : (
        <div className="min-w-0">
          <Card>
            <CardContent className="pt-6">
              <PricelistSetupTabs
                rows={pl.rows ?? []}
                products={products}
                canPublish={canPublishPricelist(me)}
                pricebookRows={pb?.rows ?? null}
                pricebookRingkas={pb?.ringkas ?? null}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
