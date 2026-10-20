import { qsDari, teruskan } from "../_gerbang";

export const dynamic = "force-dynamic";
export const GET = (req: Request) => teruskan(null, `/permintaan-produk/sku${qsDari(req, ["q"])}`, "GET", "view");
