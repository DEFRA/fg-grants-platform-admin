export type DocText = string | { text: string; bytes?: number };
export type BsonValue =
  | { t: "object"; entries: [DocText, BsonValue][] }
  | { t: "array"; items: BsonValue[] }
  | { t: "string"; v: string }
  | { t: "int32" | "double"; v: number }
  | { t: "int64" | "decimal128"; v: string | number }
  | { t: "bool"; v: boolean }
  | { t: "null" | "undefined" | "minKey" | "maxKey" }
  | { t: "date"; v: number | string }
  | { t: "objectId"; v: string }
  | { t: "binary"; v: string; sub?: number }
  | { t: "timestamp"; ts: number; i: number }
  | { t: "regex"; pattern: DocText; flags?: DocText }
  | { t: "dbPointer"; ns: DocText; id: string }
  | { t: "javascript"; code: DocText }
  | { t: "javascriptWithScope"; code: DocText; scope: BsonValue }
  | { t: "symbol"; v: DocText }
  | { t: "invalid"; text: string; bytes?: number };

export type DocSeg = [cls: string, text: string];
export type DocNode =
  | { k: "line"; d: number; segs: DocSeg[] }
  | {
      k: "node";
      d: number;
      open: boolean;
      segs: DocSeg[];
      shut: string;
      children: DocNode[];
    }
  | {
      k: "fold";
      kind: "more";
      d: number;
      summary: DocSeg[];
      children: DocNode[];
    };
export type DocModel = {
  nodes: DocNode[];
  lines: number;
};

export const DOC_DEPTH = 6;
export const DOC_ITEMS = 5;
export const DOC_LINE = 80;

const KEY = /^[A-Za-z_][\w$]*$/;
const txt = (x: DocText | undefined): string =>
  x == null ? "" : typeof x === "string" ? x : x.text;
const badText = (bytes?: number | null): string =>
  " // not valid UTF-8" +
  (bytes != null ? `, ${bytes} ${bytes === 1 ? "byte" : "bytes"}` : "");
const badNote = (bytes?: number): DocSeg => ["bad", badText(bytes)];
const badBytes = (text: string): number | null => {
  const m = /, (\d+) bytes?$/.exec(text);
  return m ? +m[1] : null;
};
const flag = (...xs: (DocText | undefined)[]): DocSeg[] =>
  xs.some((x) => x != null && typeof x !== "string")
    ? [
        badNote(
          xs.reduce<number | undefined>(
            (n, x) =>
              x != null && typeof x !== "string" && x.bytes != null
                ? (n ?? 0) + x.bytes
                : n,
            undefined,
          ),
        ),
      ]
    : [];
export const docKey = (k: DocText): DocSeg[] => [
  KEY.test(txt(k)) ? ["key", txt(k)] : ["str", docQuote(txt(k))],
  ...flag(k),
];
export function docQuote(s: string): string {
  return (
    "'" +
    String(s).replace(
      /[\\'\n\r\t\u0000-\u001f\u2028\u2029]/g,
      (c) =>
        (
          ({
            "\\": "\\\\",
            "'": "\\'",
            "\n": "\\n",
            "\r": "\\r",
            "\t": "\\t",
          }) as Record<string, string>
        )[c] ?? "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
    ) +
    "'"
  );
}

const num = (n: number): string =>
  Object.is(n, -0) ? "-0" : Number.isNaN(n) ? "NaN" : String(n);

function isoDate(v: number | string): DocSeg[] {
  const ms = typeof v === "number" ? v : Number(v);
  const d = new Date(ms);
  return Number.isFinite(ms) && !Number.isNaN(d.getTime())
    ? call("ISODate", [["str", docQuote(d.toISOString())]])
    : call("ISODate", [["str", docQuote("Invalid Date")]]);
}
function uuid(base64: string): string {
  let hex = "";
  try {
    const bin =
      typeof atob === "function"
        ? atob(base64)
        : Buffer.from(base64, "base64").toString("binary");
    for (let i = 0; i < bin.length; i++)
      hex += bin.charCodeAt(i).toString(16).padStart(2, "0");
  } catch {
    return base64;
  }
  return hex.length === 32
    ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    : hex;
}
const call = (name: string, args: DocSeg[]): DocSeg[] => [
  ["kw", name],
  ["op", "("],
  ...args,
  ["op", ")"],
];

const REGEX_BREAK: Record<string, string> = {
  "\n": "\\n",
  "\r": "\\r",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};
export function docRegexSource(p: string): string {
  if (!p) return "(?:)";
  let o = "",
    cls = false;
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "\\") {
      const n = p[i + 1];
      if (n === undefined) {
        o += c;
        continue;
      }
      i++;
      o += REGEX_BREAK[n] ?? c + n;
    } else if (REGEX_BREAK[c]) o += REGEX_BREAK[c];
    else if (cls) {
      if (c === "]") cls = false;
      o += c;
    } else if (c === "[") {
      cls = true;
      o += c;
    } else o += c === "/" ? "\\/" : c;
  }
  return o;
}
export function docScalar(v: BsonValue): DocSeg[] {
  switch (v.t) {
    case "string":
      return [["str", docQuote(v.v)]];
    case "int32":
    case "double":
      return [["num", num(v.v)]];
    case "int64":
      return call("Long", [["str", docQuote(String(v.v))]]);
    case "decimal128":
      return call("Decimal128", [["str", docQuote(String(v.v))]]);
    case "bool":
      return [["kw", String(v.v)]];
    case "null":
      return [["kw", "null"]];
    case "undefined":
      return [["kw", "undefined"]];
    case "date":
      return isoDate(v.v);
    case "objectId":
      return call("ObjectId", [["str", docQuote(v.v)]]);
    case "binary":
      return v.sub === 4
        ? call("UUID", [["str", docQuote(uuid(v.v))]])
        : call("Binary.createFromBase64", [
            ["str", docQuote(v.v)],
            ["op", ", "],
            ["num", String(v.sub ?? 0)],
          ]);
    case "timestamp":
      return call("Timestamp", [
        ["op", "{ "],
        ["key", "t"],
        ["op", ": "],
        ["num", String(v.ts)],
        ["op", ", "],
        ["key", "i"],
        ["op", ": "],
        ["num", String(v.i)],
        ["op", " }"],
      ]);
    case "regex":
      return [
        ["str", "/" + docRegexSource(txt(v.pattern)) + "/" + txt(v.flags)],
        ...flag(v.pattern, v.flags),
      ];
    case "dbPointer":
      return call("DBPointer", [
        ["str", docQuote(txt(v.ns))],
        ["op", ", "],
        ...call("ObjectId", [["str", docQuote(v.id)]]),
      ]).concat(flag(v.ns));
    case "javascript":
      return call("Code", [["str", docQuote(txt(v.code))]]).concat(
        flag(v.code),
      );
    case "javascriptWithScope":
      return call("Code", [
        ["str", docQuote(txt(v.code))],
        ["op", ", "],
        ...docInline(v.scope),
      ]).concat(flag(v.code));
    case "symbol":
      return call("BSONSymbol", [["str", docQuote(txt(v.v))]]).concat(
        flag(v.v),
      );
    case "minKey":
      return call("MinKey", []);
    case "maxKey":
      return call("MaxKey", []);
    case "invalid":
      return [["str", docQuote(v.text)], badNote(v.bytes)];
    default:
      return [["note", "?"]];
  }
}

export function docInline(v: BsonValue): DocSeg[] {
  if (v.t === "object") {
    if (!v.entries.length) return [["op", "{}"]];
    const out: DocSeg[] = [["op", "{ "]];
    v.entries.forEach(([k, x], i) => {
      if (i) out.push(["op", ", "]);
      for (const g of [...docKey(k), ["op", ": "] as DocSeg]) out.push(g);
      for (const g of docInline(x)) out.push(g);
    });
    return tidy(out.concat([["op", " }"]]));
  }
  if (v.t === "array") {
    if (!v.items.length) return [["op", "[]"]];
    const out: DocSeg[] = [["op", "[ "]];
    v.items.forEach((x, i) => {
      if (i) out.push(["op", ", "]);
      for (const g of docInline(x)) out.push(g);
    });
    return tidy(out.concat([["op", " ]"]]));
  }
  return tidy(docScalar(v));
}
export const DOC_LINE_MAX = 160;
function raw(v: BsonValue, w: Walk): void {
  if (w.len > w.stop) return;
  if (v.t === "object") {
    if (!v.entries.length) return add(w, [["op", "{}"]]);
    add(w, [["op", "{ "]]);
    for (let i = 0; i < v.entries.length && w.len <= w.stop; i++) {
      const [k, x] = v.entries[i];
      if (i) add(w, [["op", ", "]]);
      add(w, docKey(short(k, w)));
      add(w, [["op", ": "]]);
      raw(x, w);
    }
    return add(w, [["op", " }"]]);
  }
  if (v.t === "array") {
    if (!v.items.length) return add(w, [["op", "[]"]]);
    add(w, [["op", "[ "]]);
    for (let i = 0; i < v.items.length && w.len <= w.stop; i++) {
      if (i) add(w, [["op", ", "]]);
      raw(v.items[i], w);
    }
    return add(w, [["op", " ]"]]);
  }
  if (v.t === "javascriptWithScope") {
    add(w, [
      ["kw", "Code"],
      ["op", "("],
      ["str", docQuote(txt(short(v.code, w)))],
      ["op", ", "],
    ]);
    raw(v.scope, w);
    return add(w, [["op", ")"], ...flag(v.code)]);
  }
  if (v.t === "string")
    return add(w, docScalar({ t: "string", v: txt(short(v.v, w)) }));
  if (v.t === "invalid")
    return add(w, docScalar({ ...v, text: txt(short(v.text, w)) }));
  add(w, docScalar(v));
}
type Walk = { out: DocSeg[]; len: number; stop: number };
function add(w: Walk, segs: DocSeg[]): void {
  for (const s of segs) {
    w.out.push(s);
    if (s[0] !== "bad") w.len += s[1].length;
  }
}
const short = <T extends DocText>(t: T, w: Walk): DocText => {
  const s = txt(t);
  if (s.length <= w.stop) return t;
  const cut = s.slice(0, w.stop + 8);
  return typeof t === "string" ? cut : { ...(t as object), text: cut };
};
const pieces = (s: string): string[] =>
  s.match(/\\u[0-9a-fA-F]{4}|\\[\s\S]|[\s\S]/gu) ?? [];
const points = (s: string): number => Array.from(s).length;

export function docLine(
  doc: BsonValue,
  max: number = DOC_LINE_MAX,
): { segs: DocSeg[]; cut: boolean } {
  const w: Walk = { out: [], len: 0, stop: 2 * max + 8 };
  raw(doc, w);
  const all = w.out;
  const total = all.reduce(
    (n, s) => (s[0] === "bad" ? n : n + points(s[1])),
    0,
  );
  if (total <= max) return { segs: tidy(all), cut: false };
  const kept: DocSeg[] = [];
  let n = 0;
  for (let i = 0; i < all.length; i++) {
    const s = all[i];
    if (s[0] === "bad") {
      kept.push(s);
      continue;
    }
    let text = "";
    for (const p of pieces(s[1])) {
      const w = points(p);
      if (n + w > max) break;
      text += p;
      n += w;
    }
    if (text) kept.push([s[0], text]);
    if (text !== s[1]) {
      if (text && all[i + 1]?.[0] === "bad") kept.push(all[i + 1]);
      break;
    }
  }
  return { segs: tidy(kept.concat([["op", "…"]])), cut: true };
}

const same = (a: string, b: string) => docClass(a) === docClass(b);
function tidy(segs: DocSeg[]): DocSeg[] {
  const notes = segs.filter((s) => s[0] === "bad");
  const rest = segs.filter((s) => s[0] !== "bad");
  const counts = notes.map((n) => badBytes(n[1]));
  const sum = counts.some((c) => c == null)
    ? null
    : counts.reduce<number>((a, c) => a + (c as number), 0);
  const out: DocSeg[] = [];
  for (const s of rest.concat(notes.length ? [badNote(sum ?? undefined)] : []))
    if (out.length && same(out[out.length - 1][0], s[0]))
      out[out.length - 1] = [
        out[out.length - 1][0],
        out[out.length - 1][1] + s[1],
      ];
    else out.push([s[0], s[1]]);
  return out;
}
export const docText = (segs: DocSeg[]): string =>
  segs.map((s) => s[1]).join("");

const plain = (v: BsonValue) => v.t !== "object" && v.t !== "array";

function lines(
  v: BsonValue,
  d: number,
  prefix: DocSeg[],
  last: boolean,
  out: DocNode[],
  expand: number,
): void {
  const comma: DocSeg[] = last ? [] : [["op", ","]];
  const line = (segs: DocSeg[]): void => {
    out.push({ k: "line", d, segs: tidy(segs) });
  };
  if (v.t !== "object" && v.t !== "array") {
    line([...prefix, ...docScalar(v), ...comma]);
    return;
  }
  const empty = v.t === "object" ? !v.entries.length : !v.items.length;
  if (empty) {
    line([...prefix, ["op", v.t === "object" ? "{}" : "[]"], ...comma]);
    return;
  }
  if (
    d === 0 &&
    (v.t === "array"
      ? v.items.every(plain)
      : v.entries.every((e) => plain(e[1])))
  ) {
    const one = docInline(v);
    if (
      2 * d + docText(prefix).length + docText(one).length + comma.length <=
      DOC_LINE
    ) {
      line([...prefix, ...one, ...comma]);
      return;
    }
  }
  if (d === 0) {
    open(v, d, prefix, last, out, expand);
    return;
  }
  const children: DocNode[] = [];
  open(v, d, prefix, last, children, expand);
  const head = children.shift() as { segs: DocSeg[] };
  const n = v.t === "object" ? v.entries.length : v.items.length;
  const what =
    v.t === "object"
      ? n === 1
        ? "1 field"
        : `${n} fields`
      : n === 1
        ? "1 item"
        : `${n} items`;
  out.push({
    k: "node",
    d,
    open: d <= Math.min(expand, DOC_DEPTH),
    segs: head.segs,
    shut: ` … ${what} ${v.t === "object" ? "}" : "]"}${last ? "" : ","}`,
    children,
  });
}
function open(
  v: BsonValue,
  d: number,
  prefix: DocSeg[],
  last: boolean,
  out: DocNode[],
  expand: number,
): void {
  const comma: DocSeg[] = last ? [] : [["op", ","]];
  if (v.t === "object") {
    out.push({ k: "line", d, segs: tidy([...prefix, ["op", "{"]]) });
    v.entries.forEach(([k, x], i) =>
      lines(
        x,
        d + 1,
        [...docKey(k), ["op", ": "]],
        i === v.entries.length - 1,
        out,
        expand,
      ),
    );
    out.push({ k: "line", d, segs: [["op", "}"], ...comma] });
  } else if (v.t === "array") {
    out.push({ k: "line", d, segs: tidy([...prefix, ["op", "["]]) });
    const n = v.items.length;
    v.items
      .slice(0, DOC_ITEMS)
      .forEach((x, i) => lines(x, d + 1, [], i === n - 1, out, expand));
    if (n > DOC_ITEMS) {
      const children: DocNode[] = [];
      v.items
        .slice(DOC_ITEMS)
        .forEach((x, i) =>
          lines(x, d + 1, [], DOC_ITEMS + i === n - 1, children, expand),
        );
      out.push({
        k: "fold",
        kind: "more",
        d: d + 1,
        summary: [["note", `… ${n - DOC_ITEMS} more`]],
        children,
      });
    }
    out.push({ k: "line", d, segs: [["op", "]"], ...comma] });
  }
}

const shown = (n: DocNode): number =>
  n.k === "node" && n.open
    ? 1 + n.children.reduce((a, c) => a + shown(c), 0)
    : 1;
export function docModel(doc: BsonValue, expand = 0): DocModel {
  const all: DocNode[] = [];
  lines(doc, 0, [], true, all, expand);
  return { nodes: all, lines: all.reduce((a, c) => a + shown(c), 0) };
}

const TOK: Record<string, string> = {
  key: "k",
  str: "s",
  num: "n",
  kw: "w",
  note: "x",
  bad: "x",
};
export const docClass = (cls: string): string => TOK[cls] || "";
export function docFromJs(x: unknown): BsonValue {
  if (x === null) return { t: "null" };
  if (x === undefined) return { t: "undefined" };
  if (typeof x === "string") return { t: "string", v: x };
  if (typeof x === "boolean") return { t: "bool", v: x };
  if (typeof x === "number")
    return Number.isInteger(x) && Math.abs(x) < 2 ** 31
      ? { t: "int32", v: x }
      : { t: "double", v: x };
  if (Array.isArray(x)) return { t: "array", items: x.map(docFromJs) };
  const o = x as Record<string, unknown>;
  const ks = Object.keys(o);
  if (ks.length === 1) {
    if (typeof o.$oid === "string") return { t: "objectId", v: o.$oid };
    if (o.$date != null)
      return {
        t: "date",
        v: typeof o.$date === "string" ? Date.parse(o.$date) : Number(o.$date),
      };
    if (o.$numberLong != null) return { t: "int64", v: String(o.$numberLong) };
    if (o.$numberDecimal != null)
      return { t: "decimal128", v: String(o.$numberDecimal) };
  }
  return { t: "object", entries: ks.map((k) => [k, docFromJs(o[k])]) };
}

const esc = (t: string): string =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const segsHtml = (segs: DocSeg[]): string => {
  let o = "";
  for (const [c, t] of segs) {
    const k = docClass(c);
    o += k ? `<span class="${k}">${esc(t)}</span>` : esc(t);
  }
  return o;
};
function nodesHtml(nodes: DocNode[], out: string[]): void {
  for (const n of nodes)
    if (n.k === "line") out.push(" ".repeat(2 * n.d) + segsHtml(n.segs) + "\n");
    else if (n.k === "node") {
      out.push(
        `<details${n.open ? " open" : ""}><summary data-shut="${esc(n.shut).replace(/"/g, "&quot;")}">${" ".repeat(Math.max(0, 2 * n.d - 2))}<i></i>  ${segsHtml(n.segs)}</summary>`,
      );
      nodesHtml(n.children, out);
      out.push("</details>");
    } else {
      out.push(
        `<details class="m"><summary>${" ".repeat(2 * n.d)}${segsHtml(n.summary)}</summary>`,
      );
      nodesHtml(n.children, out);
      out.push("</details>");
    }
}
export function docHtml(
  doc: BsonValue,
  expand = 0,
): { html: string; lines: number } {
  const m = docModel(doc, expand);
  const out: string[] = [];
  nodesHtml(m.nodes, out);
  return {
    html: out.join("").replace(/\n(?=<details|<\/details>|$)/g, ""),
    lines: m.lines,
  };
}
