import { teruskan } from "./_gerbang";

export const dynamic = "force-dynamic";

export const GET = () => teruskan(null, "/pameran", "GET", "view");
export const POST = (req: Request) => teruskan(req, "/pameran", "POST", "create");
