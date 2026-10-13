import assert from "node:assert/strict";
import { test } from "node:test";

import { FULL_SCOPE, type DataScope } from "./access-scope.js";
import {
  AdoptionError, audienceOf, classifyAdoption, percentile, resolvePeriod, summarizeByFeature, trainingNeeds,
  type AdoptionInput, type AdoptionRow,
} from "./adoption.js";

const inp = (user_id: string, actions: number, o: Partial<AdoptionInput> = {}): AdoptionInput =>
  ({ user_id, title: "AM", feature_key: "leave", actions, views: 0, grace: false, ...o });
const label = (rows: AdoptionInput[], id: string) => classifyAdoption(rows).find((r) => r.user_id === id)!.label;
const scope = (o: Partial<DataScope>): DataScope => ({ ...FULL_SCOPE, userId: "u1", ...o });

// ── periode ──
test("P7 bulan berjalan & rolling 30 hari (batas WIB)", () => {
  assert.deepEqual(resolvePeriod("month", "2026-10", "2026-10-13"), { kind: "month", from: "2026-10-01", to: "2026-11-01", label: "2026-10", month: "2026-10" });
  assert.equal(resolvePeriod(null, null, "2026-10-13").month, "2026-10"); // default = bulan ini
  const r = resolvePeriod("rolling30", null, "2026-10-13");
  assert.equal(r.from, "2026-09-14");
  assert.equal(r.to, "2026-10-14");
  assert.equal(resolvePeriod("month", "2026-12", "2026-12-31").to, "2027-01-01"); // lintas tahun
});
test("N11 periode tak valid ditolak dengan field", () => {
  for (const [p, m] of [["week", null], ["month", "2026-13"], ["month", "26-10"], ["month", "2026-10-01"], ["month", "2026-11"]] as const) {
    assert.throws(() => resolvePeriod(p, m, "2026-10-13"), (e: unknown) => e instanceof AdoptionError && e.status === 400 && !!e.field);
  }
});

// ── audiens ──
test("P5/P6 admin, superuser, Direktur = semua; HoD ber-territory = tim", () => {
  assert.equal(audienceOf(scope({ superuser: true })), "all");
  assert.equal(audienceOf(scope({ role: "admin" })), "all");
  assert.equal(audienceOf(scope({ role: " Direktur " })), "all");
  assert.equal(audienceOf(scope({ role: "user", hodKey: "rocky", cabangScope: ["MALANG"] })), "team");
});
test("N2/N4/N8 AM, HoD tanpa territory, user biasa, tanpa identitas = ditolak", () => {
  assert.equal(audienceOf(scope({ role: "user", amOnly: true, amId: "7" })), null);
  assert.equal(audienceOf(scope({ role: "user", hodKey: "rocky", cabangScope: null })), null);
  assert.equal(audienceOf(scope({ role: "user", hodKey: "rocky", cabangScope: [] })), null);
  assert.equal(audienceOf(scope({ role: "user" })), null);
  assert.equal(audienceOf(FULL_SCOPE), null); // tak ada x-user-id → FULL_SCOPE tidak boleh jadi "lihat semua"
});

// ── klasifikasi ──
test("percentile nearest-rank", () => {
  assert.equal(percentile([], 75), 0);
  assert.equal(percentile([1, 2, 3, 4], 75), 4);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8], 75), 7);
  assert.equal(percentile([5], 75), 5);
});
test("P3 champion: persentil atas pada peer ≥ 3", () => {
  const rows = [inp("a", 40), inp("b", 10), inp("c", 8), inp("d", 6)];
  assert.equal(label(rows, "a"), "champion");
  assert.equal(label(rows, "b"), "normal");
});
test("P4/N10 laggard: nol atau sangat jarang action, berapa pun view", () => {
  const rows = [inp("a", 0, { views: 99 }), inp("b", 2), inp("c", 3), inp("d", 20)];
  assert.equal(label(rows, "a"), "laggard");
  assert.equal(label(rows, "b"), "laggard");
  assert.equal(label(rows, "c"), "normal");
});
test("E1 peer < 3: tanpa champion, laggard tetap dihitung", () => {
  const rows = [inp("a", 50), inp("b", 0)];
  assert.equal(label(rows, "a"), "normal");
  assert.equal(label(rows, "b"), "laggard");
});
test("E2/E3 semua nol / semua sama: tak ada champion", () => {
  assert.ok(classifyAdoption([inp("a", 0), inp("b", 0), inp("c", 0)]).every((r) => r.label === "laggard"));
  assert.ok(classifyAdoption([inp("a", 9), inp("b", 9), inp("c", 9)]).every((r) => r.label === "normal"));
});
test("E4 akun baru: 'baru', tak ikut statistik peer", () => {
  const rows = [inp("a", 40), inp("b", 10), inp("c", 8), inp("n", 0, { grace: true })];
  const out = classifyAdoption(rows);
  assert.equal(out.find((r) => r.user_id === "n")!.label, "baru");
  assert.equal(out.find((r) => r.user_id === "a")!.peer_size, 3);
});
test("peer dipisah per jabatan DAN per fitur", () => {
  const rows = [
    inp("a", 40, { title: "AM" }), inp("b", 10, { title: "AM" }), inp("c", 8, { title: "AM" }),
    inp("x", 3, { title: "Admin" }), // sendirian di jabatannya → bukan champion walau skor sama
    inp("a", 0, { feature_key: "visits" }),
  ];
  const out = classifyAdoption(rows);
  assert.equal(out.find((r) => r.user_id === "x")!.label, "normal");
  assert.equal(out.find((r) => r.user_id === "a" && r.feature_key === "visits")!.label, "laggard");
  assert.equal(out.find((r) => r.user_id === "a" && r.feature_key === "leave")!.label, "champion");
});

// ── ringkasan & daftar training ──
const row = (o: Partial<AdoptionRow>): AdoptionRow => ({
  user_id: "u", title: "AM", feature_key: "leave", actions: 0, views: 0, grace: false, label: "laggard", peer_size: 3,
  feature_name: "Manage Leave", name: "Budi", email: "b@x", cabang: null, on_leave: false, ...o,
});
test("daftar training: hanya laggard, terendah dulu, dibatasi limit; cuti tetap tampil", () => {
  const rows = [row({ user_id: "1", actions: 2 }), row({ user_id: "2", actions: 0, on_leave: true }), row({ user_id: "3", label: "normal", actions: 9 }), row({ user_id: "4", label: "baru" })];
  const t = trainingNeeds(rows, 10);
  assert.deepEqual(t.map((r) => r.user_id), ["2", "1"]);
  assert.equal(t[0].on_leave, true);
  assert.equal(trainingNeeds(rows, 1).length, 1);
});
test("ringkasan per fitur menghitung champion/laggard/baru", () => {
  const s = summarizeByFeature([row({ label: "champion", actions: 30 }), row({ label: "laggard" }), row({ label: "baru" }), row({ label: "normal", actions: 9 })]);
  assert.equal(s.length, 1);
  assert.deepEqual([s[0].eligible, s[0].champions, s[0].laggards, s[0].baru], [4, 1, 1, 1]);
});
