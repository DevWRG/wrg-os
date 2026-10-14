import { teruskan } from "./_gerbang";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const status = new URL(req.url).searchParams.get("status");
  return teruskan(null, `/onboarding${status ? `?status=${encodeURIComponent(status)}` : ""}`, "GET", "view");
}
export const POST = (req: Request) => teruskan(req, "/onboarding", "POST", "create");
