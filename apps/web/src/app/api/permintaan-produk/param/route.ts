import { teruskan } from "../_gerbang";

export const dynamic = "force-dynamic";
export const PATCH = (req: Request) => teruskan(req, "/permintaan-produk/param", "PATCH", "putusan");
