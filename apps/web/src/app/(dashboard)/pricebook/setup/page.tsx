import { redirect } from "next/navigation";

import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canEditPricelistSetup, canPublishPricelist } from "@/lib/pricelist-access";
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

  const pb = await getJson<{ rows: PricebookSetupRow[]; ringkas: PricebookSetupSummary }>(
    "/pricebook/setup?limit=20000",
  );

  return (
    <>
      <PageHeader
        title="Setup Harga"
        description="Setel Harga Principal (HPP), Price List & Diskon Maks per SKU keagenan, lalu publikasikan agar tampil ke AM. Angka di halaman ini internal: jangan dibagikan ke sales."
      />
      {!pb ? (
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
