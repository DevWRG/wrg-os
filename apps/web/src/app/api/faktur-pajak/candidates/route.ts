import { teruskan } from "../_gerbang";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return teruskan(null, `/faktur-pajak/candidates${new URL(req.url).search}`, "GET", "create");
}
