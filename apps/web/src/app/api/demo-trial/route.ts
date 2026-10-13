import { teruskan } from "./_gerbang";

export const dynamic = "force-dynamic";

const QS = ["jenis", "status", "am_id", "deal_id"];

export function GET(req: Request) {
  const src = new URL(req.url).searchParams;
  const qs = new URLSearchParams();
  for (const k of QS) { const v = src.get(k); if (v) qs.set(k, v); }
  return teruskan(null, `/demo-trial${qs.size ? `?${qs}` : ""}`, "GET", "view");
}
export const POST = (req: Request) => teruskan(req, "/demo-trial", "POST", "create");
