import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { Card, CardContent } from "@/components/ui/card";
import { DigestView } from "@/components/monitor/digest-view";
import { ResumeView } from "@/components/monitor/resume-view";
import { PolaView, type WaGroup } from "@/components/monitor/pola-view";
import { MonitorMembersTable } from "@/components/tables/monitor-members-table";
import { DigestsView, type History } from "@/components/digests/digests-view";

// Lima tab menu Monitor Grup WA (K1, evaluasi menu 19 Nov 2026) — dulu empat menu
// Monitor + Digest History. Isi tiap halaman dipindah apa adanya; tiap section
// mengambil datanya sendiri, jadi hanya tab aktif yang memanggil API.

interface DigestData {
  dates: string[];
  date: string | null;
  entries: { waktu: string | null; content: string }[];
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await gatewayFetch(path);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}
const kosong: DigestData = { dates: [], date: null, entries: [] };

// Rekap kolektif grup WhatsApp (ringkasan AI tiap ~5 jam). Key monitor-rekap.
export async function RekapSection() {
  return <DigestView kind="rekap" initial={(await getJson<DigestData>("/monitor/rekap")) ?? kosong} />;
}

// Resume harian (AI). Key monitor-resume (juga dipegang Komite).
export async function ResumeSection() {
  return <ResumeView initial={(await getJson<DigestData>("/monitor/resume")) ?? kosong} />;
}

// Profil pola komunikasi tiap grup (profiling AI harian). Daftar grup dari
// /monitor/groups (monitor_pola UNION wa_message) supaya grup bertraffic rendah
// tetap muncul & bisa dikategorikan. Key monitor-pola.
export async function PolaSection() {
  const [g, me] = await Promise.all([getJson<{ groups: WaGroup[] }>("/monitor/groups"), sessionUser()]);
  const canEdit = me?.role === "admin" || me?.superuser === true;
  return <PolaView groups={g?.groups ?? []} canEdit={canEdit} />;
}

interface Member {
  phone: string;
  nama: string | null;
  panggilan: string | null;
  posisi: string | null;
  cabang: string | null;
  wa_name: string | null;
  group_count: number;
  in_roster: boolean;
}

// Direktori member WhatsApp + roster organisasi. Key monitor-members.
export async function AnggotaSection() {
  const members = (await getJson<{ members: Member[] }>("/monitor/members"))?.members ?? [];
  const roster = members.filter((m) => m.in_roster).length;
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-muted-foreground mb-3 text-sm">{members.length} member · {roster} di roster organisasi.</p>
        <MonitorMembersTable members={members} />
      </CardContent>
    </Card>
  );
}

// Riwayat rekap & resume + infografis (dulu menu Digest History). Key digests.
export async function RiwayatSection() {
  return <DigestsView history={await getJson<History>("/digests")} />;
}
