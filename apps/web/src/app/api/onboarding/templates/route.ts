import { teruskan } from "../_gerbang";

export const dynamic = "force-dynamic";

// Template: gerbang menu di sini, "hanya admin/Direktur" ditegakkan apps/api (403).
export const GET = () => teruskan(null, "/onboarding/templates", "GET", "view");
export const POST = (req: Request) => teruskan(req, "/onboarding/templates", "POST", "create");
