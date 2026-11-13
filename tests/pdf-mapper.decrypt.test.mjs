import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { inflateSync, deflateSync } from "node:zlib";
import { md5, rc4, describeEncryption, unlockPdf, PdfUnlockError } from "../js/pdf-mapper/pdf-decrypt.mjs";
import { ENCRYPTED_FIXTURES, OWNER_PASSWORD, SAMPLE_TEXT } from "./fixtures/pdf-cifrados.fixtures.mjs";

const fixture = name => new Uint8Array(Buffer.from(ENCRYPTED_FIXTURES[name], "base64"));
const latin1 = bytes => Buffer.from(bytes).toString("latin1");
const fromLatin1 = text => new Uint8Array(Buffer.from(text, "latin1"));
const sampleHex = Buffer.from(SAMPLE_TEXT, "latin1").toString("hex").toUpperCase();

function streamOf(bytes, num) {
  const text = latin1(bytes);
  const m = new RegExp(`(?:^|\\s)${num} 0 obj\\s*(<<(?:(?!endobj)[\\s\\S])*?>>)\\s*stream\\r?\\n`).exec(text);
  assert.ok(m, `objeto ${num} con stream`);
  const length = Number(/\/Length\s+(\d+)/.exec(m[1])[1]);
  const start = m.index + m[0].length;
  return Buffer.from(bytes.subarray(start, start + length));
}
const pageText = bytes => inflateSync(streamOf(bytes, 6)).toString("latin1");
const stillEncrypted = bytes => /\/Encrypt\s+\d+\s+\d+\s+R/.test(latin1(bytes));
const rejects = (promise, code) => assert.rejects(promise, err => err instanceof PdfUnlockError && err.code === code);

test("md5 coincide con node:crypto y rc4 es su propia inversa", () => {
  for (let n = 0; n < 150; n++) {
    const data = randomBytes((n * 13) % 257);
    assert.equal(Buffer.from(md5(data)).toString("hex"), createHash("md5").update(data).digest("hex"));
  }
  const key = randomBytes(16), data = randomBytes(300);
  assert.deepEqual(Buffer.from(rc4(key, rc4(key, data))), data);
});

const CASES = [
  ["r2", "RC4 de 40 bits", 2],
  ["r3", "RC4 de 128 bits", 3],
  ["r4aes", "AES de 128 bits", 4],
  ["r4aesObjStm", "AES de 128 bits", 4],
  ["r5aes256", "AES de 256 bits", 5],
  ["r6aes256", "AES de 256 bits", 6]
];

for (const [name, label, revision] of CASES) {
  test(`${name}: con la contraseña de propietario queda una copia sin cifrar y legible`, async () => {
    const bytes = fixture(name);
    assert.deepEqual(await describeEncryption(bytes), { encrypted: true, supported: true, label, revision, opensWithoutPassword: true });
    const result = await unlockPdf(bytes, { password: OWNER_PASSWORD });
    assert.equal(result.via, "owner");
    assert.equal(stillEncrypted(result.bytes), false);
    assert.equal(await describeEncryption(result.bytes), null);
    if (name === "r4aesObjStm") {
      /* Los objetos comprimidos (catálogo, página…) viajan en un object stream. */
      assert.match(inflateSync(streamOf(result.bytes, 9)).toString("latin1"), /\/Type \/Catalog/);
    }
    assert.ok(pageText(result.bytes).toUpperCase().includes(sampleHex), "el texto de la página se lee");
  });

  test(`${name}: sin contraseña de propietario sólo se abre con la declaración`, async () => {
    const bytes = fixture(name);
    await rejects(unlockPdf(bytes), "owner-required");
    await rejects(unlockPdf(bytes, { password: "otra" }), "wrong-password");
    const result = await unlockPdf(bytes, { allowUserPassword: true });
    assert.equal(result.via, "user");
    assert.ok(pageText(result.bytes).toUpperCase().includes(sampleHex));
  });
}

test("PDF con contraseña de apertura: hace falta esa contraseña aunque haya declaración", async () => {
  const bytes = fixture("r3user");
  const info = await describeEncryption(bytes);
  assert.equal(info.opensWithoutPassword, false);
  await rejects(unlockPdf(bytes, { allowUserPassword: true }), "needs-password");
  await rejects(unlockPdf(bytes, { password: "abrir" }), "owner-required");
  assert.equal((await unlockPdf(bytes, { password: "abrir", allowUserPassword: true })).via, "user");
  assert.equal((await unlockPdf(bytes, { password: OWNER_PASSWORD })).via, "owner");
});

test("los metadatos UTF-16 que la librería dejó sin cifrar no se destruyen", async () => {
  const result = await unlockPdf(fixture("r2"), { password: OWNER_PASSWORD });
  assert.match(latin1(result.bytes), /\/Title <FEFF0054006900740075006C006F/);
});

test("un stream añadido sin cifrar a un PDF cifrado se conserva tal cual", async () => {
  /* Así llegó la carátula real: alguien dibujó encima de un PDF ya cifrado y
     guardó lo nuevo sin cifrar. Descifrarlo lo habría convertido en basura. */
  const text = latin1(fixture("r2"));
  const plain = deflateSync(Buffer.from(`BT /Helvetica-2774 12 Tf 20 150 Td <${sampleHex}> Tj ET`, "latin1"));
  const original = /6 0 obj\s*<<[\s\S]*?>>\s*stream\n[\s\S]*?\nendstream/.exec(text)[0];
  const replaced = `6 0 obj\n<<\n/Filter /FlateDecode\n/Length ${plain.length}\n>>\nstream\n${plain.toString("latin1")}\nendstream`;
  const mixed = fromLatin1(text.replace(original, replaced));
  const result = await unlockPdf(mixed, { password: OWNER_PASSWORD });
  assert.equal(result.keptPlain, 1);
  assert.ok(pageText(result.bytes).includes(sampleHex));
});

test("PDF sin cifrar o con cifrado no soportado", async () => {
  const plainText = latin1(fixture("r2")).replace(/\/Encrypt 8 0 R\n/, "");
  assert.equal(await describeEncryption(fromLatin1(plainText)), null);
  await rejects(unlockPdf(fromLatin1(plainText)), "not-encrypted");
  const pubSec = fromLatin1(latin1(fixture("r2")).replace("/Filter /Standard", "/Filter /Adobe.PubSec"));
  const info = await describeEncryption(pubSec);
  assert.equal(info.supported, false);
  assert.match(info.label, /certificado/);
  await rejects(unlockPdf(pubSec, { allowUserPassword: true }), "unsupported");
});
