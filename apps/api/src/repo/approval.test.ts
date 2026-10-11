import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveApprover } from "./approval.js";

// Di grup, sender_jid = group_jid. Itu bukan orang → tak boleh jadi approver,
// dan penolakan terjadi SEBELUM query (tak butuh DB).
test("resolveApprover: JID grup ditolak tanpa menyentuh DB", async () => {
  assert.equal(await resolveApprover("120363409252019573@g.us"), null);
  assert.equal(await resolveApprover(null), null);
});
