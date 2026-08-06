import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /reminders (buat reminder AM). x-user-id → backend
// write-guard row-level (AM murni hanya boleh bikin reminder atas namanya).
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const me = await sessionUser();
  try {
    const res = await gatewayFetch("/reminders", {
      method: "POST",
      headers: me
        ? { "content-type": "application/json", "x-user-id": me.id }
        : { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
