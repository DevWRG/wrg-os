import { notFound } from "next/navigation";

import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { UnduhOtomatis } from "@/components/briefings/unduh-otomatis";

export const dynamic = "force-dynamic";

// F63 — tujuan link di WA Briefing Mingguan. Halaman (bukan URL file langsung) supaya
// yang belum login diarahkan ke /login lalu kembali ke sini; unduhan dimulai otomatis,
// tombol tetap ada untuk browser bawaan WA yang memblokir unduhan otomatis.
// Gerbang izin = menu /briefings (findNavItem mencocokkan prefiks).
export default async function UnduhBriefingPage({ params }: { params: Promise<{ tahun: string; minggu: string }> }) {
  const { tahun, minggu } = await params;
  if (!/^\d{4}$/.test(tahun) || !/^\d{1,2}$/.test(minggu)) notFound();
  const href = `/api/briefing-mingguan/${tahun}/${minggu}/pdf`;
  return (
    <>
      <PageHeader title={`Briefing Mingguan W${minggu} ${tahun}`} description="PDF briefing untuk Direktur: angka WatchPoint, papan skor HoD, dan narasi minggu ini." />
      <Card>
        <CardContent className="space-y-3 pt-6">
          <UnduhOtomatis href={href} />
          <p className="text-muted-foreground text-sm">
            Isi yang sama juga bisa dibaca langsung di menu Briefings → tab Briefing Mingguan.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
