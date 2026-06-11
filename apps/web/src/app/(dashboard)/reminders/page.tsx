import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { AddReminderSheet } from "@/components/crm/add-reminder-sheet";
import { RemindersTable } from "@/components/tables/reminders-table";
import { Card, CardContent } from "@/components/ui/card";

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
}

async function getReminders(): Promise<ReminderItem[] | null> {
  try {
    const res = await gatewayFetch(`/reminders`);
    if (!res.ok) return null;
    return ((await res.json()) as { reminders: ReminderItem[] }).reminders;
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
        <p className="text-muted-foreground">Belum ada reminder. Buat via <code>POST /reminders</code>.</p>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <RemindersTable reminders={reminders} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
