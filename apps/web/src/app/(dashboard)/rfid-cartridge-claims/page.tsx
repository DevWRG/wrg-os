import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { AddRfidCartridgeClaimSheet } from "@/components/aftersales/add-rfid-cartridge-claim-sheet";
import { RfidCartridgeClaimTable, type RfidCartridgeClaim } from "@/components/aftersales/rfid-cartridge-claim-table";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

async function getClaims(): Promise<RfidCartridgeClaim[] | null> {
  try {
    const res = await gatewayFetch(`/aftersales/rfid-cartridge-claims`);
    if (!res.ok) return null;
    return ((await res.json()) as { claims: RfidCartridgeClaim[] }).claims;
  } catch {
    return null;
  }
}

export default async function RfidCartridgeClaimsPage() {
  const claims = await getClaims();

  return (
    <>
      <PageHeader
        title="RFID/Cartridge Error Claim"
        description="Klaim internal saat alat + cartridge menunjukkan error pembacaan RFID."
        action={<AddRfidCartridgeClaimSheet />}
      />
      {!claims ? (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code>.
        </p>
      ) : claims.length === 0 ? (
        <p className="text-muted-foreground">Belum ada klaim tercatat. Tambah lewat tombol &quot;Lapor Klaim&quot;.</p>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <RfidCartridgeClaimTable claims={claims} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
