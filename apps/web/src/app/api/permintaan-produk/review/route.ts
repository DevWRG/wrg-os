import { qsDari, teruskan } from "../_gerbang";

export const dynamic = "force-dynamic";
export const GET = (req: Request) => teruskan(null, `/permintaan-produk/review${qsDari(req, ["kuartal"])}`, "GET", "view");
// usulan Komite PD = hak "ubah" menu; putusan Direksi lewat review/[id]/putusan
export const POST = (req: Request) => teruskan(req, "/permintaan-produk/review", "POST", "edit");
