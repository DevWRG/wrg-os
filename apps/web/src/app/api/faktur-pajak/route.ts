import { teruskan } from "./_gerbang";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const qs = new URL(req.url).search;
  return teruskan(null, `/faktur-pajak${qs}`, "GET", "view");
}
export const POST = (req: Request) => teruskan(req, "/faktur-pajak", "POST", "create");
