import { qsDari, teruskan } from "./_gerbang";

export const dynamic = "force-dynamic";

export const GET = (req: Request) =>
  teruskan(null, `/permintaan-produk${qsDari(req, ["q", "cek", "kelompok_id", "dari", "sampai", "limit", "offset"])}`, "GET", "view");
export const POST = (req: Request) => teruskan(req, "/permintaan-produk", "POST", "create");
