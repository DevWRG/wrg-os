// Tes aturan anti-bocor `#CEK CUSTOMER` — resolusi SATU identitas customer
// sebelum SO/SJ diambil (issue #839). Murni (tanpa DB):
// `node --test apps/api/dist/repo/inbound-cek-resolve.test.js`.
//
// Angka similarity di bawah bukan karangan: pasangan "CV Sample Satu" /
// "CV Sample Dua" punya similarity 0.588 di pg_trgm — itu yang dulu bikin
// SO milik "Satu" menang atas SJ milik "Dua" (scripts/db/seed-cek-dev.sql
// kasus #5). Skor di fixture ditulis apa adanya supaya tes ini gagal kalau
// aturannya balik lagi ke "skor tertinggi menang".

import test from "node:test";
import assert from "node:assert/strict";

import { resolveCustomer, balasanAmbigu, normNama, type CustCandidate } from "./inbound-cek.js";

const c = (id: number | null, name: string, score: number): CustCandidate => ({ id, name, score });

test("nama PERSIS menang atas nama mirip berskor tinggi (kasus #5)", () => {
  // Query "CV Sample Dua": kandidat "CV Sample Satu" ikut lolos ambang karena
  // similarity 0.588, dan di implementasi lama dia yang dipakai buat header.
  const hasil = resolveCustomer("CV Sample Dua", [
    c(1, "CV Sample Satu", 0.588),
    c(2, "CV Sample Dua", 1),
  ]);
  assert.deepEqual(hasil, { kind: "one", name: "CV Sample Dua", ids: [2] });
});

test("cocok persis tak peduli beda kapital/spasi", () => {
  const hasil = resolveCustomer("  rs   sehat sentosa ", [c(7, "RS Sehat Sentosa", 0.9)]);
  assert.deepEqual(hasil, { kind: "one", name: "RS Sehat Sentosa", ids: [7] });
});

test("record kembar bernama sama = satu identitas, SEMUA id-nya dipakai", () => {
  // Faskes kembar di Accurate (mis. 744/765). Memilih salah satu diam-diam
  // akan menyembunyikan SO/SJ yang tercatat di kembarannya.
  const hasil = resolveCustomer("RSUD Iskak", [c(744, "RSUD Iskak", 1), c(765, "RSUD Iskak", 1)]);
  assert.deepEqual(hasil, { kind: "one", name: "RSUD Iskak", ids: [744, 765] });
});

test("dua nama BERBEDA lolos ambang → ambigu, tidak memilih diam-diam", () => {
  const hasil = resolveCustomer("RSUD Ke", [c(1, "RSUD Ketapang", 0.6), c(2, "RSUD Kediri", 0.55)]);
  assert.deepEqual(hasil, { kind: "ambiguous", names: ["RSUD Ketapang", "RSUD Kediri"] });
});

test("ambigu diurutkan skor tertinggi dulu dan dibatasi 5 kandidat", () => {
  const hasil = resolveCustomer(
    "RS",
    ["A", "B", "C", "D", "E", "F", "G"].map((n, i) => c(i + 1, `RS ${n}`, 0.9 - i * 0.05)),
  );
  assert.equal(hasil.kind, "ambiguous");
  if (hasil.kind !== "ambiguous") return;
  assert.deepEqual(hasil.names, ["RS A", "RS B", "RS C", "RS D", "RS E"]);
});

test("satu kandidat saja (tanpa cocok persis) tetap dipakai", () => {
  const hasil = resolveCustomer("RS Sehat", [c(3, "RS Sehat Sentosa", 0.7)]);
  assert.deepEqual(hasil, { kind: "one", name: "RS Sehat Sentosa", ids: [3] });
});

test("kandidat kosong / nama kosong → none, bukan identitas kosong", () => {
  // Nama empty-string di mirror pernah jadi jebakan: dibiarkan lolos, dia
  // akan cocok ke apa saja.
  assert.deepEqual(resolveCustomer("RS X", []), { kind: "none" });
  assert.deepEqual(resolveCustomer("RS X", [c(1, "", 0.9), c(2, "   ", 0.8)]), { kind: "none" });
});

test("jalur fallback (id null) tetap menghasilkan satu identitas bernama", () => {
  // Environment tanpa mirror accurate_customer: identitas cuma punya nama.
  const hasil = resolveCustomer("PT Testing", [c(null, "PT Testing", 1)]);
  assert.deepEqual(hasil, { kind: "one", name: "PT Testing", ids: [] });
});

test("balasan ambigu menyebut semua kandidat + contoh ketik ulang", () => {
  const s = balasanAmbigu("RSUD Ke", ["RSUD Ketapang", "RSUD Kediri"]);
  assert.match(s, /cocok ke 2 customer/);
  assert.match(s, /• RSUD Ketapang/);
  assert.match(s, /• RSUD Kediri/);
  assert.match(s, /#CEK CUSTOMER RSUD Ketapang/);
});

test("normNama merapikan spasi ganda dan kapital", () => {
  assert.equal(normNama("  RS   Sehat  Sentosa "), "rs sehat sentosa");
});
