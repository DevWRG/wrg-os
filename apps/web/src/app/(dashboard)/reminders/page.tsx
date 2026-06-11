import { apiBaseUrl } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { AddReminderSheet } from "@/components/crm/add-reminder-sheet";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

interface ReminderItem {
  id: string;
  am_id: string;
  am_name: string | null;
  reminder_date: string;
  note: string;
  customer_name: string | null;
  fired_h_minus_1: boolean;
  fired_h: boolean;
  created_at: string;
}
interface ReminderResponse {
  count: number;
  reminders: ReminderItem[];
}

const tanggal = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};

async function getReminders(): Promise<ReminderItem[] | null> {
  try {
    const res = await fetch(`${apiBaseUrl()}/reminders`, { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as ReminderResponse).reminders;
  } catch {
    return null;
  }
}

export default async function RemindersPage() {
  const reminders = await getReminders();

  return (
    <>
      <PageHeader
        title="Reminders"
        description="Reminder AM (port am_reminder) — heads-up H-1 sore & pengingat H pagi. Data live dari DB."
        action={<AddReminderSheet />}
      />

      {!reminders ? (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code>.
        </p>
      ) : reminders.length === 0 ? (
        <p className="text-muted-foreground">
          Belum ada reminder. Buat via <code>POST /reminders</code>.
        </p>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>AM</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status kirim</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reminders.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.am_name ?? r.am_id}</TableCell>
                    <TableCell className="text-muted-foreground">{tanggal(r.reminder_date)}</TableCell>
                    <TableCell>{r.note}</TableCell>
                    <TableCell className="text-muted-foreground">{r.customer_name ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {r.fired_h_minus_1 && <Badge variant="secondary">H-1 terkirim</Badge>}
                        {r.fired_h && <Badge variant="secondary">H terkirim</Badge>}
                        {!r.fired_h_minus_1 && !r.fired_h && <Badge variant="outline">menunggu</Badge>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
