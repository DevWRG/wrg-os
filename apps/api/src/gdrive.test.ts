import { test } from "node:test";
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";

import { bangunJwt, bangunMultipart, driveSiap } from "./gdrive.js";

// F130 — Google Drive lewat service account tanpa googleapis (JWT RS256 + multipart).

test("bangunJwt: klaim service account benar & tanda tangan RS256 sah", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwt = bangunJwt({ client_email: "sa@proj.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() }, 1_760_000_000);
  const [h, c, sig] = jwt.split(".");
  const dek = (s: string) => JSON.parse(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  assert.deepEqual(dek(h), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(dek(c), {
    iss: "sa@proj.iam.gserviceaccount.com", scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token", iat: 1_760_000_000, exp: 1_760_003_600,
  });
  const v = createVerify("RSA-SHA256");
  v.update(`${h}.${c}`);
  assert.equal(v.verify(publicKey, Buffer.from(sig.replace(/-/g, "+").replace(/_/g, "/"), "base64")), true);
});

test("bangunMultipart: metadata JSON lalu isi biner, dibatasi boundary", () => {
  const isi = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]); // "%PDF" + biner
  const b = bangunMultipart({ name: "Brosur.pdf", parents: ["F1"] }, isi, "application/pdf", "xyz");
  const s = b.toString("latin1");
  assert.ok(s.startsWith("--xyz\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{\"name\":\"Brosur.pdf\",\"parents\":[\"F1\"]}\r\n--xyz\r\nContent-Type: application/pdf\r\n\r\n"));
  assert.ok(s.endsWith("\r\n--xyz--"));
  assert.ok(b.includes(isi));
});

test("driveSiap: butuh kunci DAN folder tujuan", () => {
  const simpan = { k: process.env.GDRIVE_SA_KEY_FILE, f: process.env.GDRIVE_BROSUR_FOLDER_ID };
  try {
    delete process.env.GDRIVE_SA_KEY_FILE; delete process.env.GDRIVE_BROSUR_FOLDER_ID;
    assert.equal(driveSiap(), false);
    process.env.GDRIVE_SA_KEY_FILE = "/x/sa.json";
    assert.equal(driveSiap(), false);
    process.env.GDRIVE_BROSUR_FOLDER_ID = "abc";
    assert.equal(driveSiap(), true);
  } finally {
    if (simpan.k === undefined) delete process.env.GDRIVE_SA_KEY_FILE; else process.env.GDRIVE_SA_KEY_FILE = simpan.k;
    if (simpan.f === undefined) delete process.env.GDRIVE_BROSUR_FOLDER_ID; else process.env.GDRIVE_BROSUR_FOLDER_ID = simpan.f;
  }
});
