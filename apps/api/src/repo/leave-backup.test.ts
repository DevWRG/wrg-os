import assert from "node:assert/strict";
import { test } from "node:test";

import {
  backupRuleError,
  buildBackupDm,
  buildGroupNotice,
  isBackupRequired,
  parseBackupName,
  type BackupNoticeInput,
} from "./leave-backup.js";

const TODAY = "2026-10-01";

test("pengganti wajib untuk cuti yang belum selesai", () => {
  assert.equal(isBackupRequired("cuti", "2026-10-03", TODAY), true);
  assert.equal(isBackupRequired("cuti", TODAY, TODAY), true);
});

test("sakit/ijin tidak wajib pengganti", () => {
  assert.equal(isBackupRequired("sakit", "2026-10-03", TODAY), false);
  assert.equal(isBackupRequired("ijin", "2026-10-03", TODAY), false);
});

test("cuti lampau tidak wajib pengganti (data lama tetap bisa diedit)", () => {
  assert.equal(isBackupRequired("cuti", "2026-09-30", TODAY), false);
});

test("aturan: cuti tanpa pengganti ditolak, dengan pengganti lolos", () => {
  const base = { am_id: "101", jenis: "cuti", end_date: "2026-10-05" };
  assert.match(backupRuleError({ ...base, backup_am_id: null }, TODAY) ?? "", /wajib/);
  assert.equal(backupRuleError({ ...base, backup_am_id: "202" }, TODAY), null);
});

test("aturan: pengganti tidak boleh diri sendiri, apa pun jenisnya", () => {
  assert.match(backupRuleError({ am_id: "101", jenis: "sakit", end_date: "2026-10-05", backup_am_id: "101" }, TODAY) ?? "", /sama/);
});

test("parse nama pengganti dari sisa balasan WA", () => {
  assert.equal(parseBackupName(" Budi"), "Budi");
  assert.equal(parseBackupName(" @Budi Santoso"), "Budi Santoso");
  assert.equal(parseBackupName(" pengganti: Budi"), "Budi");
  assert.equal(parseBackupName(" - backup @Rina"), "Rina");
  assert.equal(parseBackupName(""), "");
  // "Backupan" bukan kata pengantar → tidak dipotong.
  assert.equal(parseBackupName(" Backupan"), "Backupan");
});

const N: BackupNoticeInput = {
  nama: "Pita",
  cabang: "Surabaya",
  jenis: "cuti",
  start_date: "2026-10-01",
  end_date: "2026-10-03",
  backup_nama: "Rina",
  backup_wa: "628123",
  updated: false,
};

test("pesan grup memuat siapa, rentang, dan pengganti + kontak", () => {
  const m = buildGroupNotice(N);
  assert.match(m, /^🔁 \*Backup PIC\*/);
  assert.match(m, /\*Pita\* \(Surabaya\) cuti 2026-10-01 s\/d 2026-10-03\./);
  assert.match(m, /ke \*Rina\* — 628123\./);
});

test("pesan grup: satu hari tanpa 's/d', tanpa cabang/kontak, tanda diperbarui", () => {
  const m = buildGroupNotice({ ...N, cabang: null, end_date: "2026-10-01", backup_wa: null, updated: true });
  assert.match(m, /Backup PIC \(diperbarui\)/);
  assert.match(m, /\*Pita\* cuti 2026-10-01\./);
  assert.match(m, /ke \*Rina\*\.$/);
});

test("DM ke pengganti menyebut siapa yang digantikan", () => {
  assert.match(buildBackupDm(N), /^Halo Rina, kamu ditunjuk sebagai \*backup PIC\* untuk \*Pita\*/);
});
