import { inflateSync, unzipSync } from "node:zlib";

/**
 * Text extraction from a PDF, with no dependency (REQ-F-055, DEC-033 ②; TASK-093).
 *
 * Why this exists: `read_url` used to decode every response as UTF-8 and run the HTML
 * stripper over it. A PDF therefore came back as 390,000 characters of inflate headers
 * and object numbers — and came back **ok**, so the garbage went into the context and the
 * database without anyone noticing (EV-2026-09-11-web-reading §3).
 *
 * Zero dependency is the same call DEC-018 made for zip: `node:zlib` already has the only
 * hard part (FlateDecode), the rest is a small content-stream reader, and a PDF library
 * would be a new runtime dependency — a one-way door — for one tool.
 *
 * What it does NOT do, on purpose:
 *   - encrypted PDFs (no decryption): reported, not attempted;
 *   - scanned PDFs (images, no text objects): reported as "no extractable text", never
 *     as an empty success — a silent empty result is the bug this module was written for;
 *   - layout, tables, reading order across columns. Text comes out in content order.
 */

/**
 * Code → text from every `ToUnicode` CMap in the document, merged into one map.
 *
 * Chinese and Japanese PDFs almost always embed subset CID fonts with `Identity-H`
 * encoding, where a glyph is a 2-byte index into the font, not a character — decoded as
 * bytes they are pure noise (the measured case: a 5.6 MB report that produced 6.6 M
 * characters of soup). The `ToUnicode` CMap is the document's own answer to "what
 * character is this glyph", so reading it is what makes those documents legible.
 *
 * Merging every font's map into one, rather than tracking which font each `Tf` selected,
 * is the deliberate simplification: resolving that properly means walking resource
 * dictionaries and object references. Subset fonts overwhelmingly occupy distinct code
 * ranges, so collisions are rare; where two fonts do collide the later map wins for that
 * code and a few characters come out wrong — still far better than the whole document
 * being unreadable, and `text` is always reported with its confidence.
 */
type CMap = Map<number, string>;

/** `<00410042>` → a JS string, treating the hex as UTF-16BE (the CMap destination form). */
function hexToUtf16(hex: string): string {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  let out = "";
  for (let i = 0; i + 3 < clean.length + 1; i += 4) {
    const unit = clean.slice(i, i + 4);
    if (unit.length < 4) break;
    out += String.fromCharCode(Number.parseInt(unit, 16));
  }
  return out;
}

export function parseCMap(content: string, into: CMap): void {
  for (const block of content.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      into.set(Number.parseInt(pair[1], 16), hexToUtf16(pair[2]));
    }
  }
  for (const block of content.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    // Form 1: <lo> <hi> <dstStart> — consecutive codes map to consecutive characters.
    for (const row of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const lo = Number.parseInt(row[1], 16);
      const hi = Number.parseInt(row[2], 16);
      const dst = row[3];
      if (hi < lo || hi - lo > 0xffff) continue;
      const base = Number.parseInt(dst.slice(-4), 16);
      const prefix = dst.length > 4 ? hexToUtf16(dst.slice(0, dst.length - 4)) : "";
      for (let code = lo; code <= hi; code += 1) {
        into.set(code, prefix + String.fromCharCode(base + (code - lo)));
      }
    }
    // Form 2: <lo> <hi> [<d1> <d2> …] — one destination per code.
    for (const row of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([\s\S]*?)\]/g)) {
      const lo = Number.parseInt(row[1], 16);
      const items = [...row[3].matchAll(/<([0-9a-fA-F]+)>/g)];
      items.forEach((item, index) => into.set(lo + index, hexToUtf16(item[1])));
    }
  }
}

/**
 * Decode one shown string. `raw` carries the original bytes as char codes 0–255.
 * When the 2-byte reading hits the CMap often enough, it is a CID string; otherwise the
 * bytes are their own characters (WinAnsi / Latin-1), which is the single-byte case.
 */
function decodeShownString(raw: string, cmap: CMap): string {
  if (cmap.size > 0 && raw.length >= 2) {
    let mapped = "";
    let hits = 0;
    let codes = 0;
    for (let i = 0; i + 1 < raw.length; i += 2) {
      const code = (raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1);
      codes += 1;
      const value = cmap.get(code);
      if (value !== undefined) {
        hits += 1;
        mapped += value;
      } else {
        mapped += "�";
      }
    }
    if (codes > 0 && hits / codes >= 0.6) {
      return mapped.replace(/�/g, "");
    }
    // A document that uses CID fonts at all will have strings belonging to fonts whose
    // map we did not resolve. Their bytes are glyph indices, so emitting them as
    // characters produces exactly the noise this module exists to stop ("ªÎÞª¾êÞ").
    // Dropping an unreadable run loses a heading; keeping it poisons the whole extract.
    if (!isPlausibleText(raw)) {
      return "";
    }
  }
  return raw;
}

/** Text a human could read: ASCII printable, CJK, or whitespace. */
function isPlausibleText(value: string): boolean {
  if (!value) return true;
  let good = 0;
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    const ascii = code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126);
    const cjk = (code >= 0x2e80 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xff00 && code <= 0xffef);
    if (ascii || cjk) good += 1;
  }
  return good / [...value].length >= 0.6;
}

/** A PDF begins with `%PDF-` within the first bytes (some files carry junk in front). */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  return head.includes("%PDF-");
}

export type PdfExtraction = {
  text: string;
  /** How many content streams were read, for the diagnostics the tool reports. */
  streams: number;
  /** Set when the document is encrypted; `text` is then empty. */
  encrypted: boolean;
};

/**
 * In a `TJ` array the numbers shift the pen horizontally by -n/1000 em: a large negative
 * value is a word gap, small values are kerning inside a word. Without this distinction
 * every kerning pair became a space — "high-efficiency" came out as "high-e fficiency".
 */
const WORD_GAP_THRESHOLD = -120;

/** `(...)` with PDF escapes, including \( \) \\ and three-digit octal. */
function decodeLiteralString(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = raw[i + 1];
    if (next === undefined) break;
    const simple: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
    if (next in simple) {
      out += simple[next];
      i += 1;
      continue;
    }
    const octal = /^[0-7]{1,3}/.exec(raw.slice(i + 1))?.[0];
    if (octal) {
      out += String.fromCharCode(Number.parseInt(octal, 8));
      i += octal.length;
      continue;
    }
    if (next === "\n") {
      i += 1; // line continuation
      continue;
    }
    out += next;
    i += 1;
  }
  return out;
}

/** `<48656c6c6f>` hex string. Odd length pads with a trailing 0 per the spec. */
function decodeHexString(raw: string): string {
  const hex = raw.replace(/[^0-9a-fA-F]/g, "");
  const padded = hex.length % 2 === 1 ? `${hex}0` : hex;
  let out = "";
  for (let i = 0; i < padded.length; i += 2) {
    out += String.fromCharCode(Number.parseInt(padded.slice(i, i + 2), 16));
  }
  return out;
}

/**
 * Walk one decompressed content stream and emit its text-showing operators in order.
 * A deliberately small reader: it tracks string literals, hex strings, TJ arrays and the
 * handful of operators that imply a break. Anything else is skipped.
 */
function readContentStream(content: string, sink: string[], cmap: CMap): void {
  let i = 0;
  // Pieces of the TJ array currently being assembled, so kerning does not split words.
  let array: string[] | null = null;

  const pushText = (value: string) => {
    const decoded = decodeShownString(value, cmap);
    if (!decoded) return;
    if (array) {
      array.push(decoded);
    } else {
      sink.push(decoded);
    }
  };

  while (i < content.length) {
    const ch = content[i];

    if (ch === "(") {
      // Scan to the matching ")", honouring escapes and nesting.
      let depth = 1;
      let j = i + 1;
      let raw = "";
      while (j < content.length && depth > 0) {
        const c = content[j];
        if (c === "\\") {
          raw += c + (content[j + 1] ?? "");
          j += 2;
          continue;
        }
        if (c === "(") depth += 1;
        if (c === ")") {
          depth -= 1;
          if (depth === 0) break;
        }
        raw += c;
        j += 1;
      }
      pushText(decodeLiteralString(raw));
      i = j + 1;
      continue;
    }

    if (ch === "<" && content[i + 1] !== "<") {
      const end = content.indexOf(">", i);
      if (end < 0) break;
      pushText(decodeHexString(content.slice(i + 1, end)));
      i = end + 1;
      continue;
    }

    if (ch === "[") {
      array = [];
      i += 1;
      continue;
    }

    if (ch === "]") {
      if (array) {
        sink.push(array.join(""));
        array = null;
      }
      i += 1;
      continue;
    }

    // A number inside a TJ array: only a wide gap becomes a space.
    const number = /^-?\d+(?:\.\d+)?/.exec(content.slice(i));
    if (number && array) {
      if (Number.parseFloat(number[0]) <= WORD_GAP_THRESHOLD) {
        array.push(" ");
      }
      i += number[0].length;
      continue;
    }

    // Operators that end a line of text.
    if (content.startsWith("T*", i) || content.startsWith("TD", i) || content.startsWith("ET", i)) {
      sink.push("\n");
      i += 2;
      continue;
    }
    if (content.startsWith("Td", i) || content.startsWith("Tm", i)) {
      sink.push(" ");
      i += 2;
      continue;
    }

    i += 1;
  }
  if (array) {
    sink.push(array.join(""));
  }
}

/** Inflate a stream body, trying raw deflate too — some writers omit the zlib header. */
function inflateStream(body: Buffer): Buffer | null {
  for (const attempt of [() => inflateSync(body), () => unzipSync(body)]) {
    try {
      return attempt();
    } catch {
      /* try the next */
    }
  }
  return null;
}

/** A decoded content stream should be mostly printable; CID fonts yield binary soup. */
function printableRatio(text: string): number {
  if (!text) return 0;
  let printable = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) {
      printable += 1;
    }
  }
  return printable / text.length;
}

export function extractPdfText(bytes: Uint8Array): PdfExtraction {
  const buf = Buffer.from(bytes);

  // An encrypted document still parses, but every string decodes to noise. Say so rather
  // than returning that noise as if it were the report's text.
  const encrypted = /\/Encrypt\s+\d+\s+\d+\s+R/.test(buf.subarray(0, Math.min(buf.length, 4 * 1024 * 1024)).toString("latin1"));
  if (encrypted) {
    return { text: "", streams: 0, encrypted: true };
  }

  // Two passes over the same inflated streams: the CMaps must all be known before any
  // content stream is read, because a font's map can be defined after its first use.
  const inflatedStreams: string[] = [];
  let cursor = 0;
  for (;;) {
    const start = buf.indexOf("stream", cursor);
    if (start < 0) break;
    const end = buf.indexOf("endstream", start);
    if (end < 0) break;

    let bodyStart = start + "stream".length;
    if (buf[bodyStart] === 0x0d) bodyStart += 1;
    if (buf[bodyStart] === 0x0a) bodyStart += 1;

    const inflated = inflateStream(buf.subarray(bodyStart, end));
    if (inflated) {
      inflatedStreams.push(inflated.toString("latin1"));
    }
    cursor = end + "endstream".length;
  }

  const cmap: CMap = new Map();
  for (const content of inflatedStreams) {
    if (content.includes("beginbfchar") || content.includes("beginbfrange")) {
      parseCMap(content, cmap);
    }
  }

  const sink: string[] = [];
  let streams = 0;
  for (const content of inflatedStreams) {
    // Content streams carry text operators; font programs and images do not.
    if (/\bTJ\b|\bTj\b|\bTD\b|\bTd\b/.test(content) && printableRatio(content) > 0.6) {
      streams += 1;
      readContentStream(content, sink, cmap);
    }
  }

  const text = sink
    .join("")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text, streams, encrypted: false };
}
