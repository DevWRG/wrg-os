#!/usr/bin/env node
// F172 Bottom Line Alat — impor biaya reagen & acuan jenis dari artifact Direktur "Bottom Line Alat KSO".
//
// Angka biaya/margin/tarif TIDAK boleh masuk repo (repo publik), jadi skrip ini membaca HTML artifact
// yang disimpan lokal dan MENCETAK SQL ke stdout — tak menyentuh DB sendiri. Jalankan di Mac mini:
//
//   node scripts/ops/impor-bottomline-biaya.mjs --artifact ~/bottomline.html > /tmp/bl.sql
//   /opt/homebrew/bin/psql -d wrg_os_prod -v ON_ERROR_STOP=1 -f /tmp/bl.sql
//
// Yang diimpor:
//   * kso_bottomline_biaya — model yang biayanya BUKAN taksiran (Simulator, harga beli, BMHP HD, …):
//     reagen per tes, reagen tetap per bulan, dan QC per bulan TERPISAH (migrasi 263 — QC gratis
//     prinsipal hanya menolkan QC). HPP standar & harga pasar TIDAK diimpor: itu isian Finance.
//     Model "Empiris" (Rp/tes × (1 − margin jenis)) tidak diimpor per model: taksiran itu dihitung
//     view 256 dari margin kotor jenis, jadi tetap ikut kalau Rp/tes OS berubah.
//   * kso_bottomline_jenis.margin_kotor — margin kotor per jenis (dasar taksiran di atas).
//   * kso_bottomline_jenis.rupiah_per_tes_manual — HANYA jenis bersatuan tindakan (Hemodialisa):
//     Rp/tes OS untuk HD tidak bermakna (faktur HD bukan per tindakan).
// Isian yang SUDAH diubah lewat layar (sumber ≠ 'impor artifact …') tidak ditimpa.
// Model yang tak ada di kso_bottomline_model_v (nama beda / di luar populasi) dilaporkan lewat NOTICE.

import { readFileSync } from "node:fs";

const i = process.argv.indexOf("--artifact");
if (i < 0 || !process.argv[i + 1]) {
  console.error("pakai: node scripts/ops/impor-bottomline-biaya.mjs --artifact <berkas.html>");
  process.exit(2);
}
const html = readFileSync(process.argv[i + 1], "utf8");
const m = html.match(/const M = (\[[\s\S]*?\]);\n/);
if (!m) {
  console.error("Data `const M = [...]` tidak ditemukan di artifact.");
  process.exit(1);
}
const M = JSON.parse(m[1]);
const SUMBER = "impor artifact Direktur 21 Okt 2026";

const q = (s) => (s == null ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);
const num = (v) => (v == null || !Number.isFinite(Number(v)) ? "NULL" : String(Number(v)));

const biaya = M.filter((x) => x.a != null && x.csrc && !/^Empiris/i.test(x.csrc) && x.csrc !== "belum ada");
const jenis = new Map();
for (const x of M) {
  if (!jenis.has(x.jenis)) jenis.set(x.jenis, { gm: x.gm, rpt: x.satuan !== "tes" ? x.rpt : null });
}

const out = [];
out.push("-- dihasilkan scripts/ops/impor-bottomline-biaya.mjs — JANGAN di-commit (berisi angka biaya)");
out.push("begin;");
out.push("drop table if exists _bl_biaya;");
out.push("create temp table _bl_biaya (model_key text, a numeric, bt numeric, qc numeric, sumber text, keyakinan text);");
if (biaya.length) {
  out.push("insert into _bl_biaya values");
  out.push(biaya.map((x) => `  (${q(x.k)}, ${num(x.a)}, ${num(x.b || 0)}, ${num(x.qc || 0)}, ${q(`${SUMBER}: ${x.csrc}`)}, ${q(x.conf)})`).join(",\n") + ";");
}
out.push(`do $$ declare r record; begin
  for r in select model_key from _bl_biaya b where not exists (select 1 from kso_bottomline_model_v v where v.model_key = b.model_key) loop
    raise notice 'model tidak ada di populasi (dilewati): %', r.model_key;
  end loop; end $$;`);
out.push(`insert into kso_bottomline_biaya (model_key, biaya_per_tes, biaya_tetap_bulan, qc_bulan, sumber, keyakinan, diubah_oleh)
select b.model_key, b.a, b.bt, b.qc, b.sumber, b.keyakinan, 'impor-artifact'
  from _bl_biaya b where exists (select 1 from kso_bottomline_model_v v where v.model_key = b.model_key)
on conflict (model_key) do update set biaya_per_tes = excluded.biaya_per_tes, biaya_tetap_bulan = excluded.biaya_tetap_bulan, qc_bulan = excluded.qc_bulan,
  sumber = excluded.sumber, keyakinan = excluded.keyakinan, diubah_oleh = excluded.diubah_oleh, diubah_at = now()
 where kso_bottomline_biaya.sumber like 'impor artifact%';`);
for (const [j, v] of jenis) {
  out.push(`insert into kso_bottomline_jenis (jenis, kelompok, margin_kotor, rupiah_per_tes_manual, diubah_oleh)
values (${q(j)}, ${q(j)}, ${num(v.gm)}, ${num(v.rpt)}, 'impor-artifact')
on conflict (jenis) do update set margin_kotor = coalesce(kso_bottomline_jenis.margin_kotor, excluded.margin_kotor),
  rupiah_per_tes_manual = coalesce(kso_bottomline_jenis.rupiah_per_tes_manual, excluded.rupiah_per_tes_manual);`);
}
out.push(`insert into kso_bottomline_log (jenis_ubah, kunci, isi, oleh)
values ('biaya', 'impor', jsonb_build_object('model', ${biaya.length}, 'jenis', ${jenis.size}, 'sumber', ${q(SUMBER)}), 'impor-artifact');`);
out.push("commit;");
out.push("select count(*) as model_berbiaya from kso_bottomline_biaya;");
process.stdout.write(out.join("\n") + "\n");
console.error(`SQL: ${biaya.length} model berbiaya, ${jenis.size} jenis.`);
