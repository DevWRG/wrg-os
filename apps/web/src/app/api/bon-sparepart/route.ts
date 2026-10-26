import { teruskan } from "./_gerbang";

export const dynamic = "force-dynamic";

// F155 Bon Sparepart — daftar + opname (GET), buat bon gudang (POST).
export async function GET(req: Request) {
  const st = new URL(req.url).searchParams.get("status");
  return teruskan(null, `/bon-sparepart${st && /^(dibuat|dilaporkan|selesai|batal)$/.test(st) ? `?status=${st}` : ""}`, "GET");
}
export async function POST(req: Request) {
  return teruskan(req, "/bon-sparepart", "POST");
}
