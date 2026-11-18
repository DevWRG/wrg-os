import { teruskan } from "../_gerbang";

export const dynamic = "force-dynamic";

export const PUT = (req: Request) => teruskan(req, "/jadwal-teknisi/interval-alat", "PUT");
