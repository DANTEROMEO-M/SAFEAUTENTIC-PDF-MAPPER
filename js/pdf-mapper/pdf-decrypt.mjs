/* ══════════════════════════════════════════════════════════════════════════
   pdf-decrypt.mjs — Desbloquea en el navegador un PDF con cifrado estándar

   Un PDF «protegido contra cambios» (como los que emite la plataforma con
   pdf-lib-plus-encrypt) se abre sin contraseña, pero su contenido va cifrado:
   pdf-lib no puede leer sus textos ni lo que se dibuja encima se ve. Este
   módulo produce una COPIA sin cifrar para usarla como plantilla en el mapper;
   el archivo original no se toca y nada sale del navegador.

   Dos formas de desbloquear, y quien llama decide cuál permite:
     · contraseña de propietario → la que autoriza a editar («owner»);
     · contraseña de apertura (vacía casi siempre) → sólo con la declaración
       del usuario de que tiene derecho a modificar el documento («user»).

   Cubre el manejador «Standard»: RC4 de 40 y 128 bits (R2, R3), AES-128
   (R4, AESV2) y AES-256 (R5 y R6, AESV3). No cubre cifrado con certificado.

   Va directamente sobre los bytes, sin pdf-lib: pdf-lib no sabe descifrar y
   con objetos comprimidos en object streams ni siquiera llega a leerlos. El
   resultado cambia longitudes (las cadenas salen en hexadecimal y AES quita
   su relleno), así que su tabla xref queda desfasada: quien lo use debe
   volver a guardarlo con pdf-lib, que lee los objetos en orden sin fiarse de
   esa tabla. Funciona igual en el navegador y en Node (WebCrypto global).
   ══════════════════════════════════════════════════════════════════════════ */

export class PdfUnlockError extends Error {
  constructor(code, message) { super(message); this.name = "PdfUnlockError"; this.code = code; }
}

/* ── Primitivas ─────────────────────────────────────────────────────────── */

const PAD = Uint8Array.from([
  0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41, 0x64, 0x00, 0x4E, 0x56, 0xFF, 0xFA, 0x01, 0x08,
  0x2E, 0x2E, 0x00, 0xB6, 0xD0, 0x68, 0x3E, 0x80, 0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A
]);
const AES_SALT = Uint8Array.from([0x73, 0x41, 0x6C, 0x54]); /* «sAlT» */
const EMPTY = new Uint8Array(0);

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const equalBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/* MD5: WebCrypto no lo trae y el estándar PDF lo exige para R2–R4. */
const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
export function md5(...parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const total = Math.ceil((len + 9) / 64) * 64;
  const buf = new Uint8Array(total);
  let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, (len * 8) >>> 0, true);
  dv.setUint32(total - 4, Math.floor(len / 2 ** 29), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Uint32Array(16);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + MD5_K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      const s = MD5_S[(i >> 4) * 4 + (i & 3)];
      B = (B + ((F << s) | (F >>> (32 - s)))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16), odv = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((w, i) => odv.setUint32(i * 4, w, true));
  return out;
}

export function rc4(key, data) {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0, j = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]]; }
  const out = new Uint8Array(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255; j = (j + s[i]) & 255; [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new PdfUnlockError("unsupported", "Este navegador no permite descifrar AES (WebCrypto no disponible).");
  return s;
};
const aesKey = (key, usage) => subtle().importKey("raw", key, "AES-CBC", false, [usage]);
async function aesCbcDecrypt(key, iv, data) {
  return new Uint8Array(await subtle().decrypt({ name: "AES-CBC", iv }, await aesKey(key, "decrypt"), data));
}
async function aesCbcEncryptNoPad(key, iv, data) {
  /* CBC sin relleno = los primeros bytes del cifrado con relleno PKCS#7. */
  const out = new Uint8Array(await subtle().encrypt({ name: "AES-CBC", iv }, await aesKey(key, "encrypt"), data));
  return out.subarray(0, data.length);
}
async function aesCbcDecryptNoPad(key, iv, data) {
  /* WebCrypto sólo descifra con relleno válido: se añade un bloque que, al
     descifrarse, da exactamente un bloque de relleno (16 × 0x10). */
  const last = data.subarray(data.length - 16);
  const block = new Uint8Array(16).map((_, i) => 16 ^ last[i]);
  const extra = await aesCbcEncryptNoPad(key, new Uint8Array(16), block);
  return aesCbcDecrypt(key, iv, concat(data, extra));
}
const sha = async (algo, data) => new Uint8Array(await subtle().digest(algo, data));

/* ── Lector mínimo de objetos PDF ───────────────────────────────────────── */

const isWs = c => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
const isDelim = c => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;
const isRegular = c => c !== undefined && !isWs(c) && !isDelim(c);

function skipWs(b, i) {
  for (;;) {
    while (i < b.length && isWs(b[i])) i++;
    if (b[i] !== 37) return i;
    while (i < b.length && b[i] !== 10 && b[i] !== 13) i++;
  }
}
const ascii = (b, start, end) => String.fromCharCode(...b.subarray(start, end));
function keywordAt(b, i, word) {
  for (let k = 0; k < word.length; k++) if (b[i + k] !== word.charCodeAt(k)) return false;
  return !isRegular(b[i + word.length]);
}

function readLiteralString(b, i) {
  const out = []; let depth = 0;
  for (; i < b.length; i++) {
    const c = b[i];
    if (c === 92) {
      const d = b[++i];
      const esc = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 }[d];
      if (esc !== undefined) out.push(esc);
      else if (d >= 48 && d <= 55) {
        let v = d - 48;
        for (let n = 0; n < 2 && b[i + 1] >= 48 && b[i + 1] <= 55; n++) v = v * 8 + (b[++i] - 48);
        out.push(v & 255);
      } else if (d === 13) { if (b[i + 1] === 10) i++; }
      else if (d !== 10) out.push(d);
      continue;
    }
    if (c === 40 && depth++ === 0) continue;
    if (c === 41 && --depth === 0) return { bytes: Uint8Array.from(out), end: i + 1 };
    out.push(c);
  }
  throw new Error("cadena sin cerrar");
}
function readHexString(b, i) {
  let hex = ""; i++;
  for (; i < b.length && b[i] !== 62; i++) if (!isWs(b[i])) hex += String.fromCharCode(b[i]);
  if (hex.length % 2) hex += "0";
  const bytes = new Uint8Array(hex.length / 2);
  for (let k = 0; k < bytes.length; k++) bytes[k] = parseInt(hex.substr(k * 2, 2), 16);
  return { bytes, end: i + 1 };
}
function readNumber(b, i) {
  let j = i;
  if (b[j] === 43 || b[j] === 45) j++;
  while ((b[j] >= 48 && b[j] <= 57) || b[j] === 46) j++;
  return j > i ? { num: Number(ascii(b, i, j)), end: j, integer: !ascii(b, i, j).includes(".") } : null;
}

/* Devuelve { value, end }. Cada cadena encontrada se anota en `strings` con
   su posición para poder reemplazarla después. */
function parseValue(b, i, strings) {
  i = skipWs(b, i);
  const c = b[i];
  if (c === 60 && b[i + 1] === 60) {
    const entries = new Map(); const start = i; i += 2;
    for (;;) {
      i = skipWs(b, i);
      if (b[i] === 62 && b[i + 1] === 62) return { value: { type: "dict", entries, start, end: i + 2 }, end: i + 2 };
      if (b[i] !== 47) throw new Error("diccionario mal formado");
      const keyStart = i;
      const key = parseValue(b, i, strings);
      const val = parseValue(b, key.end, strings);
      entries.set(key.value.name, { ...val.value, keyStart });
      i = val.end;
    }
  }
  if (c === 91) {
    const items = []; const start = i; i++;
    for (;;) {
      i = skipWs(b, i);
      if (b[i] === 93) return { value: { type: "array", items, start, end: i + 1 }, end: i + 1 };
      if (i >= b.length) throw new Error("arreglo sin cerrar");
      const v = parseValue(b, i, strings); items.push(v.value); i = v.end;
    }
  }
  if (c === 40 || c === 60) {
    const r = c === 40 ? readLiteralString(b, i) : readHexString(b, i);
    const value = { type: "string", bytes: r.bytes, start: i, end: r.end };
    strings?.push(value);
    return { value, end: r.end };
  }
  if (c === 47) {
    let j = i + 1; while (isRegular(b[j])) j++;
    const name = ascii(b, i + 1, j).replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    return { value: { type: "name", name, start: i, end: j }, end: j };
  }
  const n = readNumber(b, i);
  if (n) {
    /* «12 0 R»: referencia indirecta. */
    if (n.integer) {
      const j = skipWs(b, n.end), g = readNumber(b, j);
      if (g?.integer && j > n.end) {
        const k = skipWs(b, g.end);
        if (b[k] === 82 && !isRegular(b[k + 1])) return { value: { type: "ref", num: n.num, gen: g.num, start: i, end: k + 1 }, end: k + 1 };
      }
    }
    return { value: { type: "num", num: n.num, start: i, end: n.end }, end: n.end };
  }
  let j = i; while (isRegular(b[j])) j++;
  if (j === i) throw new Error("símbolo inesperado");
  return { value: { type: "keyword", word: ascii(b, i, j), start: i, end: j }, end: j };
}

const nameOf = v => v?.type === "name" ? v.name : null;
const filtersOf = dict => {
  const f = dict.entries.get("Filter");
  return f?.type === "name" ? [f.name] : f?.type === "array" ? f.items.map(nameOf).filter(Boolean) : [];
};

/* Recorre el archivo objeto por objeto («N G obj … endobj»), saltando los
   datos de cada stream, y anota los diccionarios «trailer» que hay entre
   objetos. No necesita la tabla xref. */
function scanPdf(b) {
  const text = latin1(b);
  const header = /(\d+)\s+(\d+)\s+obj\b/g;
  const objects = [], trailers = [];
  const lengthCache = new Map();
  const lookupLength = ref => {
    const k = `${ref.num} ${ref.gen}`;
    if (!lengthCache.has(k)) {
      const m = new RegExp(`(?:^|[^0-9])${ref.num}\\s+${ref.gen}\\s+obj\\s*(\\d+)\\s*endobj`).exec(text);
      lengthCache.set(k, m ? Number(m[1]) : null);
    }
    return lengthCache.get(k);
  };
  const scanTrailers = (from, to) => {
    for (let t = text.indexOf("trailer", from); t >= 0 && t < to; t = text.indexOf("trailer", t + 7)) {
      try { trailers.push(parseValue(b, t + 7, null).value); } catch { /* trailer ilegible: se ignora */ }
    }
  };
  let pos = 0, m;
  while ((m = header.exec(text))) {
    if (m.index > 0 && isRegular(b[m.index - 1])) continue;
    scanTrailers(pos, m.index);
    const num = Number(m[1]), gen = Number(m[2]), bodyStart = m.index + m[0].length;
    const strings = [];
    let parsed;
    try { parsed = parseValue(b, bodyStart, strings); }
    catch { header.lastIndex = bodyStart; continue; }
    const obj = { num, gen, start: m.index, value: parsed.value, strings, stream: null, end: parsed.end };
    let i = skipWs(b, parsed.end);
    if (parsed.value.type === "dict" && keywordAt(b, i, "stream")) {
      let dataStart = i + 6;
      if (b[dataStart] === 13 && b[dataStart + 1] === 10) dataStart += 2;
      else if (b[dataStart] === 10 || b[dataStart] === 13) dataStart += 1;
      const lenEntry = parsed.value.entries.get("Length");
      let length = lenEntry?.type === "num" ? lenEntry.num : lenEntry?.type === "ref" ? lookupLength(lenEntry) : null;
      const endsAt = at => { const k = skipWs(b, at); return keywordAt(b, k, "endstream") ? k : -1; };
      let dataEnd = length != null && dataStart + length <= b.length && endsAt(dataStart + length) >= 0 ? dataStart + length : -1;
      let endKeyword;
      if (dataEnd >= 0) endKeyword = endsAt(dataEnd);
      else {
        endKeyword = text.indexOf("endstream", dataStart);
        if (endKeyword < 0) break;
        dataEnd = endKeyword;
        if (b[dataEnd - 1] === 10) dataEnd--;
        if (b[dataEnd - 1] === 13) dataEnd--;
      }
      obj.stream = { dataStart, dataEnd };
      i = endKeyword + 9;
    }
    i = skipWs(b, i);
    obj.end = keywordAt(b, i, "endobj") ? i + 6 : i;
    objects.push(obj);
    pos = obj.end;
    header.lastIndex = obj.end;
  }
  scanTrailers(pos, text.length);
  for (const o of objects) if (o.value.type === "dict" && nameOf(o.value.entries.get("Type")) === "XRef") trailers.push(o.value);
  return { objects, trailers };
}
function latin1(b) {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return s;
}

/* ── Diccionario de cifrado ─────────────────────────────────────────────── */

function readEncryption(scan) {
  const trailer = [...scan.trailers].reverse().find(t => t.entries?.has("Encrypt"));
  if (!trailer) return null;
  const ref = trailer.entries.get("Encrypt");
  let dict = ref;
  if (ref.type === "ref") {
    const obj = [...scan.objects].reverse().find(o => o.num === ref.num && o.gen === ref.gen);
    dict = obj?.value;
  }
  if (dict?.type !== "dict") return { supported: false, label: "cifrado ilegible" };
  const e = dict.entries;
  const num = k => e.get(k)?.type === "num" ? e.get(k).num : undefined;
  const str = k => e.get(k)?.type === "string" ? e.get(k).bytes : null;
  const filter = nameOf(e.get("Filter"));
  const V = num("V") ?? 0, R = num("R") ?? 0;
  const idArr = [...scan.trailers].reverse().map(t => t.entries?.get("ID")).find(v => v?.type === "array");
  const id0 = idArr?.items[0]?.type === "string" ? idArr.items[0].bytes : EMPTY;
  const cf = e.get("CF");
  const methodOf = name => {
    if (!name || V < 4) return "RC4";
    if (name === "Identity") return "Identity";
    const f = cf?.type === "dict" ? cf.entries.get(name) : null;
    const cfm = f?.type === "dict" ? nameOf(f.entries.get("CFM")) : null;
    return cfm === "AESV2" ? "AESV2" : cfm === "AESV3" ? "AESV3" : cfm === "V2" ? "RC4" : cfm === "None" ? "Identity" : cfm || "Identity";
  };
  const stmF = methodOf(V >= 4 ? nameOf(e.get("StmF")) || "Identity" : null);
  const strF = methodOf(V >= 4 ? nameOf(e.get("StrF")) || "Identity" : null);
  let keyBits = V === 1 ? 40 : num("Length") ?? 40;
  if (V === 4) {
    const std = cf?.type === "dict" ? cf.entries.get(nameOf(e.get("StmF")) || "StdCF") : null;
    const cfLen = std?.type === "dict" && std.entries.get("Length")?.type === "num" ? std.entries.get("Length").num : null;
    keyBits = cfLen ? (cfLen <= 32 ? cfLen * 8 : cfLen) : Math.max(keyBits, 128);
  }
  if (V === 5) keyBits = 256;
  const encryptMetadata = e.get("EncryptMetadata")?.word !== "false";
  const info = {
    filter, V, R, keyBits, P: (num("P") ?? 0) | 0, O: str("O"), U: str("U"), OE: str("OE"), UE: str("UE"),
    id0, stmF, strF, encryptMetadata, ref: ref.type === "ref" ? ref : null,
    label: V === 5 ? "AES de 256 bits" : [stmF, strF].includes("AESV2") ? "AES de 128 bits" : `RC4 de ${keyBits} bits`
  };
  const methods = new Set([stmF, strF]);
  info.supported = filter === "Standard" && [1, 2, 4, 5].includes(V) && R >= 2 && R <= 6 && !!info.O && !!info.U
    && [...methods].every(mt => ["RC4", "AESV2", "AESV3", "Identity"].includes(mt))
    && (V < 5 || (!!info.OE && !!info.UE));
  if (filter && filter !== "Standard") info.label = `cifrado con certificado (${filter})`;
  return info;
}

/* ── Claves ─────────────────────────────────────────────────────────────── */

const legacyPassword = pw => Uint8Array.from([...pw].map(ch => ch.charCodeAt(0) & 255));
const utf8Password = pw => new TextEncoder().encode(pw).subarray(0, 127);
function padPassword(pw) {
  const out = new Uint8Array(32), n = Math.min(32, pw.length);
  out.set(pw.subarray(0, n)); out.set(PAD.subarray(0, 32 - n), n);
  return out;
}
const keyBytesOf = enc => enc.R === 2 ? 5 : enc.keyBits / 8;

function legacyFileKey(enc, paddedUser) {
  const p = new Uint8Array(4); new DataView(p.buffer).setInt32(0, enc.P, true);
  const n = keyBytesOf(enc);
  let key = md5(paddedUser, enc.O.subarray(0, 32), p, enc.id0, enc.R >= 4 && !enc.encryptMetadata ? Uint8Array.of(255, 255, 255, 255) : EMPTY);
  if (enc.R >= 3) for (let i = 0; i < 50; i++) key = md5(key.subarray(0, n));
  return key.subarray(0, n);
}
function legacyUserMatches(enc, key) {
  if (enc.R === 2) return equalBytes(rc4(key, PAD), enc.U.subarray(0, 32));
  let x = rc4(key, md5(PAD, enc.id0));
  for (let i = 1; i <= 19; i++) x = rc4(key.map(v => v ^ i), x);
  return equalBytes(x.subarray(0, 16), enc.U.subarray(0, 16));
}
function legacyUserKey(enc, password) {
  const key = legacyFileKey(enc, padPassword(legacyPassword(password)));
  return legacyUserMatches(enc, key) ? key : null;
}
function legacyOwnerKey(enc, password) {
  const n = keyBytesOf(enc);
  let h = md5(padPassword(legacyPassword(password)));
  if (enc.R >= 3) for (let i = 0; i < 50; i++) h = md5(h);
  const k = h.subarray(0, n);
  let user = enc.O.subarray(0, 32);
  if (enc.R === 2) user = rc4(k, user);
  else for (let i = 19; i >= 0; i--) user = rc4(k.map(v => v ^ i), user);
  const key = legacyFileKey(enc, user);
  return legacyUserMatches(enc, key) ? key : null;
}

/* Algoritmo 2.B (R6): SHA-256/384/512 encadenados con AES-128. R5 usa un
   solo SHA-256. */
async function hashV5(enc, password, salt, udata) {
  let K = await sha("SHA-256", concat(password, salt, udata));
  if (enc.R === 5) return K;
  let E, i = 0;
  while (i < 64 || E[E.length - 1] > i - 32) {
    const unit = concat(password, K, udata);
    const K1 = new Uint8Array(unit.length * 64);
    for (let r = 0; r < 64; r++) K1.set(unit, r * unit.length);
    E = await aesCbcEncryptNoPad(K.subarray(0, 16), K.subarray(16, 32), K1);
    let sum = 0; for (let j = 0; j < 16; j++) sum += E[j];
    K = await sha(["SHA-256", "SHA-384", "SHA-512"][sum % 3], E);
    i++;
  }
  return K.subarray(0, 32);
}
async function v5Key(enc, password, owner) {
  const pw = utf8Password(password);
  const src = owner ? enc.O : enc.U, udata = owner ? enc.U.subarray(0, 48) : EMPTY;
  const check = await hashV5(enc, pw, src.subarray(32, 40), udata);
  if (!equalBytes(check.subarray(0, 32), src.subarray(0, 32))) return null;
  const inter = await hashV5(enc, pw, src.subarray(40, 48), udata);
  return aesCbcDecryptNoPad(inter.subarray(0, 32), new Uint8Array(16), (owner ? enc.OE : enc.UE).subarray(0, 32));
}

const userKey = (enc, pw) => enc.V === 5 ? v5Key(enc, pw, false) : legacyUserKey(enc, pw);
const ownerKey = (enc, pw) => enc.V === 5 ? v5Key(enc, pw, true) : legacyOwnerKey(enc, pw);

/* ── Descifrado de objetos ──────────────────────────────────────────────── */

function objectKey(fileKey, num, gen, method) {
  if (method === "AESV3") return fileKey;
  const id = Uint8Array.of(num & 255, (num >> 8) & 255, (num >> 16) & 255, gen & 255, (gen >> 8) & 255);
  return md5(fileKey, id, method === "AESV2" ? AES_SALT : EMPTY).subarray(0, Math.min(fileKey.length + 5, 16));
}
async function decryptBytes(data, key, method) {
  if (method === "Identity" || !data.length) return data;
  if (method === "RC4") return rc4(key, data);
  if (data.length < 32 || data.length % 16) throw new Error("bloque AES incompleto");
  return aesCbcDecrypt(key, data.subarray(0, 16), data.subarray(16));
}

/* ¿Parece ya decodificable? Sirve para detectar streams que alguien añadió
   sin cifrar a un PDF cifrado: descifrarlos los destruiría. */
function looksPlain(data, dict) {
  const f = filtersOf(dict)[0];
  if (f === "FlateDecode" || f === "Fl") return data.length >= 2 && (data[0] & 15) === 8 && ((data[0] << 8) | data[1]) % 31 === 0;
  if (f === "DCTDecode" || f === "DCT") return data[0] === 0xFF && data[1] === 0xD8;
  return null;
}

const toHex = bytes => "<" + Array.from(bytes, v => v.toString(16).padStart(2, "0")).join("") + ">";
const asciiBytes = s => Uint8Array.from(s, ch => ch.charCodeAt(0));

/* ── API ────────────────────────────────────────────────────────────────── */

/* Qué cifrado tiene el PDF y si se abre sin contraseña. `null` si no está
   cifrado. */
const ENCRYPT_KEY = [47, 69, 110, 99, 114, 121, 112, 116]; /* «/Encrypt» */
function mentionsEncrypt(b) {
  outer: for (let i = b.indexOf(47); i >= 0 && i <= b.length - 8; i = b.indexOf(47, i + 1)) {
    for (let k = 1; k < 8; k++) if (b[i + k] !== ENCRYPT_KEY[k]) continue outer;
    return true;
  }
  return false;
}

export async function describeEncryption(bytes) {
  /* Atajo: la gran mayoría de los PDF ni siquiera menciona /Encrypt. */
  if (!mentionsEncrypt(bytes)) return null;
  const enc = readEncryption(scanPdf(bytes));
  if (!enc) return null;
  let opensWithoutPassword = false;
  if (enc.supported) { try { opensWithoutPassword = !!(await userKey(enc, "")); } catch { /* sin WebCrypto */ } }
  return { encrypted: true, supported: enc.supported, label: enc.label, revision: enc.R, opensWithoutPassword };
}

/* Copia sin cifrar. `password` se prueba primero como contraseña de
   propietario; sólo si `allowUserPassword` (el usuario declaró que puede
   modificarlo) se acepta también como contraseña de apertura, vacía incluida.
   → { bytes, via: "owner" | "user", streams, strings, keptPlain } */
export async function unlockPdf(bytes, { password = "", allowUserPassword = false } = {}) {
  const scan = scanPdf(bytes);
  const enc = readEncryption(scan);
  if (!enc) throw new PdfUnlockError("not-encrypted", "Este PDF no está cifrado.");
  if (!enc.supported) throw new PdfUnlockError("unsupported", `Este PDF usa ${enc.label}, que el mapper no sabe descifrar.`);
  let via = "owner", fileKey = await ownerKey(enc, password);
  if (!fileKey) {
    const asUser = await userKey(enc, password);
    if (asUser && allowUserPassword) { fileKey = asUser; via = "user"; }
    else if (asUser) throw new PdfUnlockError("owner-required", password
      ? "Esa es la contraseña para abrirlo, no la de propietario. Escribe la de propietario o marca la declaración."
      : "Escribe la contraseña de propietario o marca la declaración para abrirlo sin ella.");
    else throw new PdfUnlockError(password ? "wrong-password" : "needs-password", password
      ? "La contraseña no es correcta."
      : "Este PDF pide contraseña incluso para abrirse: escríbela.");
  }

  const edits = [];
  const blank = (start, end) => edits.push({ start, end, bytes: new Uint8Array(end - start).fill(32) });
  let streams = 0, strings = 0, keptPlain = 0;
  for (const obj of scan.objects) {
    const dict = obj.value.type === "dict" ? obj.value : null;
    const type = dict && nameOf(dict.entries.get("Type"));
    if (type === "XRef") { if (dict.entries.has("Encrypt")) blank(dict.entries.get("Encrypt").keyStart, dict.entries.get("Encrypt").end); continue; }
    if (enc.ref && obj.num === enc.ref.num && obj.gen === enc.ref.gen) continue;
    if (enc.strF !== "Identity") {
      const key = objectKey(fileKey, obj.num, obj.gen, enc.strF);
      for (const s of obj.strings) {
        let plain;
        try { plain = await decryptBytes(s.bytes, key, enc.strF); } catch { continue; }
        /* Texto UTF-16 con su marca (FE FF) que dejaría de serlo: la cadena
           ya venía sin cifrar (pdf-lib-plus-encrypt no cifra los metadatos). */
        if (s.bytes[0] === 0xFE && s.bytes[1] === 0xFF && !(plain[0] === 0xFE && plain[1] === 0xFF)) continue;
        edits.push({ start: s.start, end: s.end, bytes: asciiBytes(toHex(plain)) });
        strings++;
      }
    }
    if (!obj.stream || enc.stmF === "Identity") continue;
    if (type === "Metadata" && !enc.encryptMetadata) continue;
    if (filtersOf(dict).includes("Crypt")) continue;
    const raw = bytes.subarray(obj.stream.dataStart, obj.stream.dataEnd);
    let data;
    try { data = await decryptBytes(raw, objectKey(fileKey, obj.num, obj.gen, enc.stmF), enc.stmF); }
    catch { data = null; }
    if (!data || (looksPlain(data, dict) === false && looksPlain(raw, dict) === true)) { keptPlain++; continue; }
    streams++;
    edits.push({ start: obj.stream.dataStart, end: obj.stream.dataEnd, bytes: data });
    const len = dict.entries.get("Length");
    if (data.length !== raw.length && len) edits.push({ start: len.start, end: len.end, bytes: asciiBytes(String(data.length)) });
  }
  for (const t of scan.trailers) {
    const entry = t.entries?.get("Encrypt");
    if (entry && !edits.some(e => e.start === entry.keyStart)) blank(entry.keyStart, entry.end);
  }

  edits.sort((a, b) => a.start - b.start);
  const parts = []; let at = 0;
  for (const e of edits) {
    if (e.start < at) continue;
    parts.push(bytes.subarray(at, e.start), e.bytes);
    at = e.end;
  }
  parts.push(bytes.subarray(at));
  return { bytes: concat(...parts), via, streams, strings, keptPlain };
}
