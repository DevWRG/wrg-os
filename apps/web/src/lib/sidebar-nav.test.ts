import { test } from "node:test";
import assert from "node:assert/strict";
import { LayoutGrid } from "lucide-react";

import type { NavGroup } from "./nav";
import { AMBANG_LIPAT, grupTerbukaAwal, menuAktif, saringMenu } from "./sidebar-nav";

const it = (title: string, url: string, extra = {}) => ({ title, url, icon: LayoutGrid, ...extra });
const G: NavGroup[] = [
  { label: "Finance", items: [it("Kas Station", "/kas-station"), it("DO Belum Difaktur", "/do-belum-faktur")] },
  { label: "Sales", items: [it("Pipeline", "/pipeline"), it("Sales Docs", "/sales-docs", { matchPrefix: ["/sph"] })] },
];

test("menu aktif: prefix, exact, matchPrefix", () => {
  assert.ok(menuAktif(G[1].items[0], "/pipeline/123"));
  assert.ok(menuAktif(G[1].items[1], "/sph/new"));
  assert.ok(!menuAktif(it("Insentif", "/insentif", { exact: true }), "/insentif/tim"));
});

test("cari: per kata, ke judul atau label grup, tanpa beda huruf", () => {
  assert.deepEqual(saringMenu(G, "faktur").flatMap((g) => g.items.map((i) => i.url)), ["/do-belum-faktur"]);
  assert.deepEqual(saringMenu(G, "finance kas").flatMap((g) => g.items.map((i) => i.url)), ["/kas-station"]);
  assert.equal(saringMenu(G, "  ").length, 2);
  assert.equal(saringMenu(G, "tidakada").length, 0);
});

test("grup terbuka awal: semua bila sedikit, hanya grup aktif bila banyak", () => {
  assert.equal(grupTerbukaAwal(G, "/pipeline").size, 2);
  const banyak: NavGroup[] = [
    { label: "A", items: Array.from({ length: AMBANG_LIPAT }, (_, i) => it(`a${i}`, `/a${i}`)) },
    { label: "B", items: [it("b", "/b")] },
  ];
  assert.deepEqual([...grupTerbukaAwal(banyak, "/b")], ["B"]);
});
