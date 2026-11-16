import assert from "node:assert/strict";
import { test } from "node:test";

import { hapusFotoStart, jamWib, pesanIngatReport, type FsFoto } from "./teknisi-start.js";

function fsPalsu(o: { ada?: boolean; symlink?: boolean; berkas?: boolean; real?: string } = {}): FsFoto & { dihapus: string[] } {
  const dihapus: string[] = [];
  return {
    dihapus,
    async lstat() {
      if (o.ada === false) throw Object.assign(new Error("x"), { code: "ENOENT" });
      return { isFile: () => o.berkas !== false, isSymbolicLink: () => !!o.symlink };
    },
    async realpath(p: string) { return p === "/root" ? "/root" : (o.real ?? p); },
    async unlink(p: string) { dihapus.push(p); },
  };
}

test("hapusFotoStart: hanya foto di dalam root, bukan symlink", async () => {
  const ok = fsPalsu();
  assert.deepEqual(await hapusFotoStart("/root/inbound/a.jpg", { root: "/root", fs: ok }), { status: "dihapus" });
  assert.deepEqual(ok.dihapus, ["/root/inbound/a.jpg"]);
  assert.deepEqual(await hapusFotoStart("/root/a.pdf", { root: "/root", fs: fsPalsu() }), { status: "ditolak", alasan: "bukan-foto" });
  assert.deepEqual(await hapusFotoStart("/etc/a.jpg", { root: "/root", fs: fsPalsu() }), { status: "ditolak", alasan: "di-luar-root" });
  assert.deepEqual(await hapusFotoStart("/root/a.jpg", { root: "/root", fs: fsPalsu({ symlink: true }) }), { status: "ditolak", alasan: "symlink" });
  assert.deepEqual(await hapusFotoStart("/root/a.jpg", { root: "/root", fs: fsPalsu({ real: "/lain/a.jpg" }) }), { status: "ditolak", alasan: "di-luar-root" });
  assert.deepEqual(await hapusFotoStart("/root/a.jpg", { root: "/root", fs: fsPalsu({ ada: false }) }), { status: "tidak-ada" });
  assert.deepEqual(await hapusFotoStart("", { root: "/root", fs: fsPalsu() }), { status: "ditolak", alasan: "path-kosong" });
});

test("jamWib & pesan pengingat", () => {
  assert.equal(jamWib("2026-11-16T02:05:00Z"), "09:05");
  const t = pesanIngatReport("Budi", [{ urut: 1, faskes: "RS A", jam: "09:05" }, { urut: 51, faskes: null, jam: "13:10" }]);
  assert.match(t, /^⏰ Budi, pekerjaan ini sudah di-#START tapi belum di-#REPORT:\n• No\. 1 · RS A · mulai 09:05\n• No\. 51 · mulai 13:10/);
});
