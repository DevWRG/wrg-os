import { teruskan } from "../_gerbang";

export const dynamic = "force-dynamic";

export const POST = (req: Request) => teruskan(req, "/jadwal-teknisi/susun", "POST");
