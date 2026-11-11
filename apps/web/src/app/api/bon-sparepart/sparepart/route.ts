import { teruskan } from "../_gerbang";

export const dynamic = "force-dynamic";

// Pencarian master sparepart (accurate_item) untuk form bon.
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 80);
  return teruskan(null, `/bon-sparepart/sparepart?q=${encodeURIComponent(q)}`, "GET");
}
