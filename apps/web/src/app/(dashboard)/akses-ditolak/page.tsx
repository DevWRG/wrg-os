import Link from "next/link";
import { Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

// Tujuan redirect gate rute di (dashboard)/layout.tsx. Sengaja halaman
// tersendiri (bukan render kondisional di layout): kalau layout cuma menukar
// isi <main>, halaman aslinya TETAP ikut ter-render & masuk RSC payload di HTML
// — jadi datanya bocor walau tak tampak. Redirect memutus render itu.
export const dynamic = "force-dynamic";

export default async function AksesDitolakPage({
  searchParams,
}: {
  searchParams: Promise<{ menu?: string }>;
}) {
  const { menu } = await searchParams;
  return (
    <Card>
      <CardContent>
        <EmptyState
          icon={Lock}
          title="Akses ditolak"
          description={
            menu
              ? `Kamu tidak punya izin membuka ${menu}. Hubungi admin bila menu ini seharusnya bisa diakses.`
              : "Kamu tidak punya izin membuka halaman ini. Hubungi admin bila ini seharusnya bisa diakses."
          }
          action={
            <Button variant="outline" render={<Link href="/" />} nativeButton={false}>
              Kembali ke beranda
            </Button>
          }
        />
      </CardContent>
    </Card>
  );
}
