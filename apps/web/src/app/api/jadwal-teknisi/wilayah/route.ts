import { teruskan } from "../_gerbang";

export const dynamic = "force-dynamic";

export const GET = () => teruskan(null, "/jadwal-teknisi/wilayah", "GET");
export const PUT = (req: Request) => teruskan(req, "/jadwal-teknisi/wilayah", "PUT");
