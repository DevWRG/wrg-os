import { teruskan } from "./_gerbang";

export const dynamic = "force-dynamic";

export const GET = () => teruskan(null, "/campaigns", "GET", "view");
export const POST = (req: Request) => teruskan(req, "/campaigns", "POST", "create");
