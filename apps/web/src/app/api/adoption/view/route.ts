import { sessionUser } from "@/lib/admin-guard";
import { sendUsageEvent } from "@/lib/adoption-record";
import { viewFeatureFor } from "@/lib/adoption-capture";
import { featureAllowed } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// F58 — pencatatan VIEW dari <UsageBeacon/>. Server yang menentukan feature_key dari path
// (klien tak bisa mengarang), dan hanya mencatat bila user memang berhak membuka halaman itu.
// Selalu 204: beacon tak perlu tahu hasilnya, dan kegagalan tak boleh terlihat user.
export async function POST(req: Request) {
  const me = await sessionUser();
  if (!me) return new Response(null, { status: 204 });
  try {
    const body = (await req.json()) as { path?: unknown };
    const path = typeof body.path === "string" ? body.path : "";
    const key = viewFeatureFor(path);
    if (key && featureAllowed(me, path.split("?")[0], "view")) void sendUsageEvent(me.id, key, "view");
  } catch {
    /* body rusak → abaikan */
  }
  return new Response(null, { status: 204 });
}
