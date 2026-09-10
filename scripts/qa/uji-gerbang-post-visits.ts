// Uji gerbang tulis POST /visits — MANUAL, butuh DB dev. Bukan bagian CI.
//
//   DATABASE_URL="postgres:///wrg_os_dev" npx tsx scripts/qa/uji-gerbang-post-visits.ts
//
// Predikatnya disalin persis dari apps/api/src/index.ts (POST /visits). Yang
// diuji resolveScope yang SEBENARNYA terhadap akun nyata, jadi ia menangkap
// kalau `role` berhenti terbawa di DataScope.
//
import { db } from "../../apps/api/src/db.js";
import { resolveScope } from "../../apps/api/src/repo/access-scope.js";

const sql = db();
// Predikat yang SAMA dengan yang dipasang di endpoint.
const tolakViewer = (role: unknown) => /^viewer$/i.test(String(role ?? ""));
const tolakAmLain = (s: { amOnly: boolean; amId: string | null }, amId: string) =>
  s.amOnly && !!s.amId && amId !== s.amId;

let gagal = 0;
const cek = (nama: string, ok: boolean, ket = "") => {
  console.log(`${ok ? "  ✔" : "  ✘"} ${nama}${ket ? "  — " + ket : ""}`);
  if (!ok) gagal++;
};

async function main() {
  const akun = await sql<{ id: string; role: string; am_id: string | null }[]>`
    SELECT au.id, au.role, au.am_id
      FROM app_user au LEFT JOIN master_user mu ON mu.am_id = au.am_id
     WHERE au.active
     ORDER BY CASE au.role WHEN 'viewer' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, au.id`;

  const viewer = akun.find((a) => a.role === "viewer")!;
  const admin = akun.find((a) => a.role === "admin")!;
  const amRows = await sql<{ id: string; am_id: string }[]>`
    SELECT au.id, au.am_id FROM app_user au JOIN master_user mu ON mu.am_id = au.am_id
     WHERE au.active AND upper(mu.role) = 'AM' ORDER BY au.id LIMIT 2`;
  const [am1, am2] = amRows;

  console.log("1) viewer");
  const sv = await resolveScope(viewer.id);
  cek("role terbaca 'viewer'", sv.role === "viewer", String(sv.role));
  cek("DITOLAK menulis", tolakViewer(sv.role));

  console.log("2) admin");
  const sa = await resolveScope(admin.id);
  cek("role terbaca 'admin'", sa.role === "admin", String(sa.role));
  cek("BOLEH menulis", !tolakViewer(sa.role) && !tolakAmLain(sa, am1.am_id));

  console.log("3) AM");
  const sm = await resolveScope(am1.id);
  cek("amOnly = true", sm.amOnly === true);
  cek("BOLEH atas nama sendiri", !tolakAmLain(sm, am1.am_id));
  cek("DITOLAK atas nama AM lain", tolakAmLain(sm, am2.am_id), `${am1.am_id} -> ${am2.am_id}`);

  console.log("4) tanpa x-user-id (FULL_SCOPE)");
  const sf = await resolveScope(undefined);
  cek("role kosong → tak tertolak sbg viewer", !tolakViewer(sf.role));
  cek("amOnly false → tak tertolak", !tolakAmLain(sf, am1.am_id));
  console.log("     (inilah sebabnya BFF WAJIB meneruskan x-user-id)");

  console.log(gagal === 0 ? "\nSEMUA LULUS" : `\n${gagal} GAGAL`);
  await sql.end();
  process.exit(gagal === 0 ? 0 : 1);
}
main();
