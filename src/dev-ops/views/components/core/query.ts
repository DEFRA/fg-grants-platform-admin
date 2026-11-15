export type QueryValue = {
  value: string | number;
  count?: number;
  label?: string;
};
export type QueryField = {
  name: string;
  detail?: string;
  type?: "text" | "number" | "date" | "list" | "flag";
  values?: QueryValue[];
};
export type QuerySource = {
  name: string;
  detail?: string;
  fields: QueryField[];
};
export type QueryVocabulary = {
  sources: QuerySource[];
  anything?: boolean;
  open?: boolean;
};
export type QueryToken = {
  k: string;
  v?: string | number;
  flags?: string;
  at: number;
  end: number;
  closed?: boolean;
  text: string;
};
export type QueryProblem = { message: string; at: number; end: number };
export type QuerySuggestion = {
  insert: string;
  label: string;
  detail?: string;
  kind:
    | "field"
    | "function"
    | "operator"
    | "value"
    | "keyword"
    | "source"
    | "method"
    | "stage";
};
export type QueryValuesWanted = {
  source: string;
  field: string;
  q: string;
  inList: boolean;
};
export type QuerySuggestions = {
  items: QuerySuggestion[];
  from: number;
  to: number;
  values: QueryValuesWanted | null;
};
export type QuerySegment = { text: string; cls: string; err: boolean };

const qeTable = (o: Record<string, string>): Record<string, string> =>
  Object.assign(Object.create(null), o);
const qeFilterOps = qeTable({
  $eq: "is",
  $ne: "isn’t",
  $gt: "more than",
  $gte: "at least",
  $lt: "less than",
  $lte: "at most",
  $in: "one of",
  $nin: "none of",
  $exists: "given or not",
  $regex: "matches a pattern",
  $options: "the pattern's flags: 'i' for any case",
  $not: "not",
});
const qeLogic = qeTable({
  $and: "all of these",
  $or: "any of these",
  $nor: "none of these",
});
const qeStages = qeTable({
  $match: "which records",
  $unwind: "one row per value of a list",
  $group: "counts and totals per value",
  $sort: "the order",
  $limit: "how many",
  $project: "the fields to show",
});
const qeAccumulators = qeTable({
  $sum: "total, or 1 to count",
  $min: "lowest or earliest",
  $max: "highest or latest",
  $count: "how many",
});
const qeExpressions = qeTable({
  $size: "how many values",
  $sum: "total",
  $min: "lowest or earliest",
  $max: "highest or latest",
});
const qeMethods = qeTable({
  find: "records and the fields to show",
  aggregate: "a pipeline: $match, $group, $sort, $limit",
  countDocuments: "how many",
  distinct: "the different values of a field",
});
const qeChained = qeTable({
  sort: "the order",
  limit: "how many",
});
const qeOperators: Record<string, string> = Object.assign(
  Object.create(null),
  qeFilterOps,
  qeLogic,
  qeStages,
  qeAccumulators,
  qeExpressions,
);

export function qeTokenize(s: string): QueryToken[] {
  const out: QueryToken[] = [];
  let i = 0,
    prev: QueryToken | null = null;
  const push = (t: QueryToken) => {
    out.push(t);
    prev = t;
  };
  while (i < s.length) {
    const c = s[i];
    let m: RegExpExecArray | null;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const at = i;
    if (s.startsWith("//", i)) {
      const e = s.indexOf("\n", i);
      i = e < 0 ? s.length : e;
      out.push({ k: "comment", at, end: i, text: s.slice(at, i) });
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1,
        v = "";
      while (j < s.length && s[j] !== c && s[j] !== "\n") {
        if (s[j] === "\\" && j + 1 < s.length) {
          v += s[j + 1];
          j += 2;
        } else v += s[j++];
      }
      const closed = s[j] === c;
      i = closed ? j + 1 : j;
      push({ k: "str", v, at, end: i, closed, text: s.slice(at, i) });
      continue;
    }
    const p = prev as QueryToken | null;
    if (c === "/" && (!p || /^[:,[(]$/.test(p.k))) {
      let j = i + 1,
        src = "";
      while (j < s.length && s[j] !== "/" && s[j] !== "\n") {
        if (s[j] === "\\") {
          src += s[j] + (s[j + 1] ?? "");
          j += 2;
        } else src += s[j++];
      }
      const closed = s[j] === "/";
      if (closed) j++;
      const flags = /^[a-z]*/.exec(s.slice(j))![0];
      i = j + flags.length;
      push({
        k: "re",
        v: src,
        flags,
        at,
        end: i,
        closed,
        text: s.slice(at, i),
      });
      continue;
    }
    if (
      (m = /^-?\d+(\.\d+)?/.exec(s.slice(i))) &&
      !(p && p.k === "word" && p.end === i)
    ) {
      i += m[0].length;
      push({ k: "num", v: +m[0], at, end: i, text: m[0] });
      continue;
    }
    if ((m = /^\$?[A-Za-z_]\w*/.exec(s.slice(i)))) {
      i += m[0].length;
      push({ k: "word", v: m[0], at, end: i, text: m[0] });
      continue;
    }
    if ("{}[]():,.;".indexOf(c) >= 0) {
      i++;
      push({ k: c, at, end: i, text: c });
      continue;
    }
    i++;
    push({ k: "bad", at, end: i, text: c });
  }
  return out;
}

const qeSource = (vocab: QueryVocabulary, name: string | undefined) =>
  vocab.sources.find((x) => x.name === name);
const qeSourceOf = (vocab: QueryVocabulary, s: string) => {
  const named = /\bdb\s*\.\s*(\w+)/.exec(s);
  return named ? qeSource(vocab, named[1]) : vocab.sources[0];
};
const qeField = (src: QuerySource | undefined, name: string) =>
  src?.fields.find((f) => f.name === name);
const qeKeyText = (name: string) =>
  /^[A-Za-z_][\w]*$/.test(name)
    ? name
    : "'" + name.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
const qeRefers = (top: { k: string; ctx: string } | undefined) =>
  !!top &&
  (top.k === "{" || top.k === "[") &&
  ["group", "acc", "expr", "project", "unwind"].includes(top.ctx);
const qeUnwind = qeTable({
  path: "the list, as '$field'",
  preserveNullAndEmptyArrays: "keep records with none",
});
const qeList = (names: string[]) =>
  names.length < 2
    ? names.join("")
    : names.slice(0, -1).join(", ") + " or " + names[names.length - 1];

type QeFrame = {
  k: string;
  name?: string;
  arg: number;
  ctx: string;
  key: string | null;
  field: string | null;
  expect: string;
};
function qeWalk(
  toks: QueryToken[],
  each?: (t: QueryToken, top: QeFrame | undefined, i: number) => void,
) {
  const stack: QeFrame[] = [];
  toks.forEach((t, i) => {
    const top = stack[stack.length - 1];
    if (each) each(t, top, i);
    if (t.k === "(") {
      const m = toks[i - 1];
      stack.push({
        k: "(",
        name: m ? String(m.v ?? "") : "",
        arg: 0,
        ctx: "",
        key: null,
        field: null,
        expect: "",
      });
    } else if (t.k === "{") {
      let ctx = "filter";
      if (top && top.k === "(")
        ctx =
          top.name === "find"
            ? top.arg === 0
              ? "filter"
              : "project"
            : top.name === "sort"
              ? "sort"
              : top.name === "countDocuments" || top.name === "distinct"
                ? "filter"
                : "value";
      else if (top && top.k === "[")
        ctx =
          top.ctx === "pipeline"
            ? "stage"
            : top.ctx === "logic"
              ? "filter"
              : "value";
      else if (top && top.k === "{")
        ctx =
          top.ctx === "stage"
            ? ((
                {
                  $match: "filter",
                  $group: "group",
                  $sort: "sort",
                  $project: "project",
                  $unwind: "unwind",
                } as Record<string, string>
              )[top.key ?? ""] ?? "value")
            : top.ctx === "filter"
              ? top.key && qeLogic[top.key]
                ? "filter"
                : "ops"
              : top.ctx === "group"
                ? "acc"
                : top.ctx === "project"
                  ? "expr"
                  : "value";
      stack.push({
        k: "{",
        arg: 0,
        ctx,
        key: null,
        field:
          top && top.k === "{" && top.ctx === "filter"
            ? top.key
            : (top?.field ?? null),
        expect: "key",
      });
    } else if (t.k === "[") {
      const ctx =
        top && top.k === "(" && top.name === "aggregate"
          ? "pipeline"
          : top && top.k === "{" && top.key && qeLogic[top.key]
            ? "logic"
            : "values";
      stack.push({
        k: "[",
        arg: 0,
        ctx,
        key: top?.key ?? null,
        field: top?.ctx === "filter" ? top.key : (top?.field ?? null),
        expect: "",
      });
    } else if (t.k === "}" || t.k === "]" || t.k === ")") stack.pop();
    else if (t.k === ",") {
      if (top && top.k === "(") top.arg++;
      if (top && top.k === "{") {
        top.expect = "key";
        top.key = null;
      }
    } else if (t.k === ":") {
      if (top && top.k === "{") top.expect = "value";
    } else if (
      (t.k === "word" || t.k === "str") &&
      top &&
      top.k === "{" &&
      top.expect === "key"
    )
      top.key = String(t.v);
  });
  return stack;
}

export function qeCheck(
  s: string,
  vocab: QueryVocabulary,
): QueryProblem | null {
  const toks = qeTokenize(s).filter((t) => t.k !== "comment");
  const at = (t: QueryToken | undefined, message: string): QueryProblem =>
    t
      ? { message, at: t.at, end: t.end }
      : { message, at: s.length, end: s.length + 1 };
  if (!toks.length) return null;
  const bad = toks.find((t) => t.k === "bad");
  if (bad) return at(bad, `“${bad.text}” isn’t part of a query`);
  const open = toks.find((t) => (t.k === "str" || t.k === "re") && !t.closed);
  if (open)
    return at(
      open,
      open.k === "re"
        ? "This pattern isn’t closed: add /"
        : `This text isn’t closed: add ${open.text[0]}`,
    );
  const opens: QueryToken[] = [];
  const pair: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  for (const t of toks) {
    if (t.k === "(" || t.k === "[" || t.k === "{") opens.push(t);
    else if (pair[t.k]) {
      const o = opens.pop();
      if (!o || o.k !== pair[t.k]) return at(t, `This ${t.k} closes nothing`);
    }
  }
  if (opens.length) {
    const o = opens[opens.length - 1];
    return at(
      o,
      `This ${o.k} isn’t closed: add ${({ "(": ")", "[": "]", "{": "}" } as Record<string, string>)[o.k]}`,
    );
  }
  if (toks[0].k !== "word" || toks[0].v !== "db")
    return at(
      toks[0],
      "Start with db. and what to look in: db." +
        vocab.sources[0]?.name +
        ".find({ … })",
    );
  if (toks[1]?.k !== ".") return at(toks[1], "Add . after db");
  const coll = toks[2];
  if (!coll || coll.k !== "word" || !qeSource(vocab, String(coll.v)))
    return at(coll, "db." + qeList(vocab.sources.map((x) => x.name)));
  const src = qeSource(vocab, String(coll.v))!;
  let problem: QueryProblem | null = null,
    calls = 0;
  qeWalk(toks, (t, top, i) => {
    if (problem) return;
    const prev = toks[i - 1];
    if (t.k === "word" && prev?.k === "." && i > 2) {
      const first = toks[i - 2]?.k === "word" && toks[i - 2] === coll;
      const method = toks[4]?.v;
      if (
        first
          ? !qeMethods[String(t.v)]
          : method !== "find" || !qeChained[String(t.v)]
      )
        problem = at(
          t,
          first
            ? "A method goes here: " + qeList(Object.keys(qeMethods))
            : method === "find"
              ? "Then .sort({ … }) or .limit(…)"
              : "Nothing follows ." +
                method +
                "(…)" +
                (method === "aggregate"
                  ? ": sort and limit with $sort and $limit stages"
                  : ""),
        );
      else calls++;
    } else if (
      t.k === "word" &&
      String(t.v)[0] === "$" &&
      !qeOperators[String(t.v)]
    )
      problem = at(t, `${t.v} isn’t one of the operators you can use`);
    else if (
      t.k === "str" &&
      !vocab.open &&
      qeRefers(top) &&
      String(t.v)[0] === "$" &&
      String(t.v).length > 1 &&
      !qeField(src, String(t.v).slice(1))
    )
      problem = at(t, `${src.name} has no field ${String(t.v).slice(1)}`);
  });
  if (problem) return problem;
  if (!calls)
    return at(
      undefined,
      "Add a method: " +
        qeList(Object.keys(qeMethods).map((m) => "." + m + "(…)")),
    );
  return null;
}

export function qePaint(
  s: string,
  vocab: QueryVocabulary,
  problem?: QueryProblem | null,
): QuerySegment[] {
  const toks = qeTokenize(s),
    src = qeSourceOf(vocab, s),
    out: QuerySegment[] = [];
  const aliases = new Set<number>(),
    aliasNames = new Set<string>(),
    keys = new Set<number>();
  qeWalk(toks, (t, top, i) => {
    const next = toks[i + 1];
    if (
      t.k === "str" &&
      next?.k === ":" &&
      top?.k === "{" &&
      top.expect === "key"
    )
      keys.add(i);
    if (
      (t.k === "word" || t.k === "str") &&
      next?.k === ":" &&
      top?.k === "{" &&
      top.expect === "key"
    ) {
      const after = toks[i + 2],
        op = toks[i + 3];
      if (
        top.ctx === "group" ||
        (top.ctx === "project" &&
          after?.k === "{" &&
          op &&
          qeExpressions[String(op.v)])
      ) {
        aliases.add(i);
        aliasNames.add(String(t.v));
      }
      if (top.ctx === "unwind" && qeUnwind[String(t.v)]) aliases.add(i);
    }
  });
  let pos = 0;
  const add = (from: number, to: number, cls: string) => {
    if (to <= from) return;
    const cuts = [from, to];
    if (problem)
      for (const c of [problem.at, problem.end])
        if (c > from && c < to) cuts.push(c);
    cuts.sort((a, b) => a - b);
    for (let k = 0; k < cuts.length - 1; k++) {
      const a = cuts[k],
        b = cuts[k + 1];
      if (b > a)
        out.push({
          text: s.slice(a, b),
          cls,
          err: !!problem && problem.at < b && problem.end > a,
        });
    }
  };
  toks.forEach((t, i) => {
    add(pos, t.at, "");
    const prev = toks[i - 1],
      next = toks[i + 1];
    let cls = "op";
    if (t.k === "str" && next?.k === ":" && keys.has(i))
      cls =
        vocab.open ||
        qeField(src, String(t.v)) ||
        aliases.has(i) ||
        aliasNames.has(String(t.v))
          ? "name"
          : "unknown";
    else if (t.k === "str" || t.k === "re") cls = "str";
    else if (t.k === "num") cls = "num";
    else if (t.k === "comment") cls = "comment";
    else if (t.k === "word") {
      const w = String(t.v);
      if (w[0] === "$" || /^(db|true|false|null|ISODate|Date|new)$/.test(w))
        cls = "kw";
      else if (prev?.k === "." && (qeMethods[w] || qeChained[w])) cls = "fn";
      else if (prev?.k === "." && qeSource(vocab, w)) cls = "name";
      else if (next?.k === ":")
        cls =
          vocab.open ||
          qeField(src, w) ||
          w === "_id" ||
          (w === "anything" && vocab.anything !== false) ||
          aliases.has(i) ||
          aliasNames.has(w)
            ? "name"
            : "unknown";
      else cls = "name";
    }
    add(t.at, t.end, cls);
    pos = t.end;
  });
  add(pos, s.length, "");
  if (problem && problem.at >= s.length)
    out.push({ text: " ", cls: "eol", err: true });
  return out;
}

const qeQuote = (v: string | number) =>
  typeof v === "number"
    ? String(v)
    : "'" + String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";

export function qeSuggest(
  s: string,
  caret: number,
  vocab: QueryVocabulary,
): QuerySuggestions {
  let toks = qeTokenize(s.slice(0, caret)).filter((t) => t.k !== "comment");
  const last = toks[toks.length - 1];
  let partial = "",
    from = caret;
  if (
    last &&
    last.end === caret &&
    (last.k === "word" ||
      ((last.k === "str" || last.k === "re") && !last.closed))
  ) {
    partial = last.k === "word" ? last.text : String(last.v);
    from = last.at;
    toks = toks.slice(0, -1);
  }
  const prev = toks[toks.length - 1],
    prev2 = toks[toks.length - 2],
    src = qeSourceOf(vocab, s);
  const fields = (
    suffix = "",
    keep: (f: QueryField) => boolean = () => true,
  ): QuerySuggestion[] =>
    (src?.fields ?? []).filter(keep).map((f) => ({
      insert: (suffix.startsWith(":") ? qeKeyText(f.name) : f.name) + suffix,
      label: f.name,
      detail: f.detail,
      kind: "field",
    }));
  const keys = (
    o: Record<string, string>,
    suffix: string,
    kind: QuerySuggestion["kind"],
  ): QuerySuggestion[] =>
    Object.keys(o).map((k) => ({
      insert: k + suffix,
      label: k,
      detail: o[k],
      kind,
    }));
  const ref = (f: QuerySuggestion) =>
    Object.assign(f, {
      insert: "'$" + f.label + "'",
      label: "'$" + f.label + "'",
    });
  let values: QueryValuesWanted | null = null;
  const vals = (name: string | null, inList: boolean): QuerySuggestion[] => {
    const f = name ? qeField(src, name) : undefined;
    if (!f || !src) return [];
    if (f.type === "flag")
      return [
        { insert: "true", label: "true", detail: "yes", kind: "value" },
        { insert: "false", label: "false", detail: "no", kind: "value" },
      ];
    values = { source: src.name, field: f.name, q: partial, inList };
    if (f.type === "date")
      return [
        {
          insert: "'2026-10-01'",
          label: "'2026-10-01'",
          detail: "a date, YYYY-MM-DD",
          kind: "value",
        },
      ];
    return qeValueItems(f.values ?? [], partial);
  };
  let out: QuerySuggestion[] = [];
  const stack = qeWalk(toks),
    top = stack[stack.length - 1];
  if (!toks.length)
    out = [
      { insert: "db.", label: "db.", detail: "Start here", kind: "keyword" },
    ];
  else if (prev?.k === "." && prev2?.v === "db")
    out = vocab.sources.map((x) => ({
      insert: x.name + ".",
      label: x.name,
      detail: x.detail,
      kind: "source",
    }));
  else if (
    prev?.k === "." &&
    prev2?.k === "word" &&
    qeSource(vocab, String(prev2.v))
  )
    out = keys(qeMethods, "", "method").map((x) =>
      Object.assign(x, {
        insert:
          x.label +
          (x.label === "aggregate"
            ? "(["
            : x.label === "distinct"
              ? "('"
              : "({ "),
      }),
    );
  else if (prev?.k === "." && prev2?.k === ")" && toks[4]?.v === "find")
    out = [
      {
        insert: "sort({ ",
        label: "sort",
        detail: "the order: { created: -1 }",
        kind: "method",
      },
      { insert: "limit(", label: "limit", detail: "how many", kind: "method" },
    ];
  else if (prev?.k === ")" && !stack.length && toks[4]?.v === "find")
    out = [
      { insert: ".", label: ".", detail: "sort or limit", kind: "keyword" },
    ];
  else if (top?.k === "(" && top.name === "distinct" && top.arg === 0)
    out = fields("', { ").map((x) =>
      Object.assign(x, { insert: "'" + x.insert }),
    );
  else if (top?.k === "(" && top.name === "limit")
    out = ["50", "100", "500"].map((n) => ({
      insert: n + ")",
      label: n,
      kind: "value",
    }));
  else if (
    top?.k === "[" &&
    top.ctx === "pipeline" &&
    (!prev || prev.k === "[" || prev.k === ",")
  )
    out = [{ insert: "{ ", label: "{", detail: "a stage", kind: "keyword" }];
  else if (
    top?.k === "[" &&
    top.ctx === "logic" &&
    (prev?.k === "[" || prev?.k === ",")
  )
    out = [{ insert: "{ ", label: "{", detail: "a filter", kind: "keyword" }];
  else if (
    top?.k === "[" &&
    top.ctx === "values" &&
    (prev?.k === "[" || prev?.k === ",")
  )
    out = vals(top.field, true);
  else if (top?.k === "[" && top.ctx === "values")
    out = [
      { insert: ", ", label: ",", detail: "Another value", kind: "keyword" },
      { insert: "]", label: "]", detail: "End the list", kind: "keyword" },
    ];
  else if (
    top?.k === "{" &&
    top.expect === "key" &&
    (prev?.k === "{" || prev?.k === ",")
  ) {
    if (top.ctx === "filter")
      out =
        partial[0] === "$"
          ? keys(qeLogic, ": [", "operator")
          : fields(": ").concat(
              vocab.anything === false
                ? []
                : [
                    {
                      insert: "anything: ",
                      label: "anything",
                      detail: "Any field at all",
                      kind: "field",
                    },
                  ],
              keys(qeLogic, ": [", "operator"),
            );
    else if (top.ctx === "ops") out = keys(qeFilterOps, ": ", "operator");
    else if (top.ctx === "project") out = fields(": 1");
    else if (top.ctx === "sort") out = fields(": -1");
    else if (top.ctx === "stage")
      out = keys(qeStages, "", "stage").map((x) =>
        Object.assign(x, {
          insert:
            x.label +
            (x.label === "$limit"
              ? ": "
              : x.label === "$unwind"
                ? ": '$"
                : ": { "),
        }),
      );
    else if (top.ctx === "group")
      out = [
        {
          insert: "_id: '$",
          label: "_id",
          detail: "the field to group by",
          kind: "keyword",
        },
        {
          insert: "count: { $sum: 1 }",
          label: "count",
          detail: "how many in each group",
          kind: "function",
        },
      ];
    else if (top.ctx === "acc") out = keys(qeAccumulators, ": ", "operator");
    else if (top.ctx === "unwind")
      out = keys(qeUnwind, ": ", "keyword").map((x) =>
        Object.assign(x, {
          insert: x.label + (x.label === "path" ? ": '$" : ": "),
        }),
      );
    else if (top.ctx === "expr") out = keys(qeExpressions, ": '$", "operator");
  } else if (top?.k === "{" && top.expect === "value" && prev?.k === ":") {
    const k = top.key ?? "";
    if (top.ctx === "filter")
      out = (k === "anything" ? [] : vals(k, false)).concat([
        {
          insert: "{ $",
          label: "{ $…",
          detail: "a comparison: $gt, $in, $exists …",
          kind: "operator",
        },
        {
          insert: "/",
          label: "/pattern/i",
          detail: "contains, any case",
          kind: "operator",
        },
      ]);
    else if (top.ctx === "ops")
      out =
        k === "$exists"
          ? [
              { insert: "true", label: "true", detail: "given", kind: "value" },
              {
                insert: "false",
                label: "false",
                detail: "not given",
                kind: "value",
              },
            ]
          : k === "$in" || k === "$nin"
            ? [
                {
                  insert: "[",
                  label: "[",
                  detail: "a list of values",
                  kind: "keyword",
                },
              ]
            : k === "$options"
              ? [
                  {
                    insert: "'i'",
                    label: "'i'",
                    detail: "any case",
                    kind: "value",
                  },
                ]
              : k === "$regex"
                ? [
                    {
                      insert: "/",
                      label: "/pattern/i",
                      detail: "contains, any case",
                      kind: "operator",
                    },
                  ]
                : vals(top.field, false);
    else if (top.ctx === "project")
      out = [{ insert: "1", label: "1", detail: "show it", kind: "value" }];
    else if (top.ctx === "sort")
      out = [
        {
          insert: "-1",
          label: "-1",
          detail: "highest or newest first",
          kind: "value",
        },
        {
          insert: "1",
          label: "1",
          detail: "lowest or oldest first",
          kind: "value",
        },
      ];
    else if (top.ctx === "group" && k === "_id") out = fields().map(ref);
    else if (top.ctx === "stage" && k === "$unwind")
      out = fields()
        .map(ref)
        .concat([
          {
            insert: "{ path: '$",
            label: "{ path: … }",
            detail: "with preserveNullAndEmptyArrays",
            kind: "keyword",
          },
        ]);
    else if (top.ctx === "unwind")
      out =
        k === "path"
          ? fields().map(ref)
          : [
              {
                insert: "true",
                label: "true",
                detail: "keep them",
                kind: "value",
              },
              {
                insert: "false",
                label: "false",
                detail: "drop them",
                kind: "value",
              },
            ];
    else if (top.ctx === "acc")
      out = (
        k === "$sum"
          ? [
              {
                insert: "1",
                label: "1",
                detail: "count them",
                kind: "value",
              } as QuerySuggestion,
            ]
          : []
      ).concat(
        fields(
          "",
          (f) => f.type === "number" || (f.type === "date" && k !== "$sum"),
        ).map(ref),
      );
  }
  if (
    last &&
    last.k === "str" &&
    !last.closed &&
    String(last.v)[0] === "$" &&
    qeRefers(top)
  )
    out = fields().map(ref);
  const bare = (l: string) => l.replace(/^'?\$?/, "");
  if (
    last?.k === "str" &&
    !last.closed &&
    partial.includes(".") &&
    out.some((x) => x.kind === "field")
  ) {
    const ref = partial[0] === "$",
      typed = ref ? partial.slice(1) : partial,
      head = typed.slice(0, typed.lastIndexOf(".") + 1);
    const seen = new Set<string>(),
      segments: QuerySuggestion[] = [];
    for (const f of src?.fields ?? []) {
      if (!f.name.startsWith(head)) continue;
      const rest = f.name.slice(head.length),
        seg = rest.split(".")[0];
      if (!rest.includes(".") || seen.has(seg)) continue;
      seen.add(seg);
      segments.push({
        insert: "'" + (ref ? "$" : "") + head + seg + ".",
        label: (ref ? "'$" : "") + head + seg + ".",
        detail: "more under it",
        kind: "field",
      });
    }
    out = segments.concat(
      out.filter((x) => x.kind === "field" && bare(x.label).startsWith(head)),
    );
  }
  if (
    last?.k === "word" &&
    last.end === caret &&
    /^(true|false|null)$/.test(String(last.v)) &&
    top?.k === "{" &&
    top.expect === "value" &&
    prev?.k === ":"
  )
    return {
      items: [
        { insert: ", ", label: ",", detail: "and another", kind: "keyword" },
        { insert: " }", label: "}", detail: "that's all", kind: "keyword" },
      ],
      from: caret,
      to: caret,
      values: null,
    };
  if (
    last?.k === "word" &&
    last.end === caret &&
    /^(true|false|null)$/.test(String(last.v)) &&
    top?.k === "[" &&
    top.ctx === "values" &&
    (prev?.k === "[" || prev?.k === ",")
  )
    return {
      items: [
        { insert: ", ", label: ",", detail: "Another value", kind: "keyword" },
        { insert: "]", label: "]", detail: "End the list", kind: "keyword" },
      ],
      from: caret,
      to: caret,
      values: null,
    };
  const end = toks[toks.length - 1];
  if (
    !partial &&
    top?.k === "{" &&
    top.expect === "value" &&
    end &&
    end.end <= caret &&
    (((end.k === "str" || end.k === "re") && end.closed) ||
      end.k === "num" ||
      (end.k === "word" && /^(true|false|null)$/.test(String(end.v))))
  )
    out = [
      { insert: ", ", label: ",", detail: "and another", kind: "keyword" },
      { insert: " }", label: "}", detail: "that's all", kind: "keyword" },
    ];
  const p = partial.toLowerCase().replace(/^\$/, "");
  out = out.filter((x) => {
    const l = x.label.toLowerCase().replace(/^'?\$?/, "");
    return (
      !p ||
      l.startsWith(p) ||
      (x.kind === "field" && (x.detail ?? "").toLowerCase().includes(p)) ||
      (x.kind === "value" && l.includes(p))
    );
  });
  if (
    p &&
    out.length === 1 &&
    out[0].label.toLowerCase().replace(/^'?\$?/, "") === p
  )
    out = [];
  if (
    !out.length &&
    last?.k === "word" &&
    last.end === caret &&
    prev?.k === "." &&
    prev2?.v === "db" &&
    qeSource(vocab, String(last.v))
  )
    return {
      items: keys(qeMethods, "", "method").map((x) =>
        Object.assign(x, {
          label: "." + x.label,
          insert:
            "." +
            x.label +
            (x.label === "aggregate"
              ? "(["
              : x.label === "distinct"
                ? "('"
                : "({ "),
        }),
      ),
      from: caret,
      to: caret,
      values: null,
    };
  return { items: out.slice(0, 40), from, to: caret, values };
}

export function qeValueItems(
  list: QueryValue[],
  typed = "",
): QuerySuggestion[] {
  const q = typed.toLowerCase();
  return list
    .filter((x) => !q || String(x.value).toLowerCase().includes(q))
    .slice(0, 8)
    .map((x) => {
      const n =
        x.count == null
          ? ""
          : x.count === 1
            ? "1 record"
            : x.count.toLocaleString("en-GB") + " records";
      return {
        insert: qeQuote(x.value),
        label: qeQuote(x.value),
        detail: [x.label, n].filter(Boolean).join(", ") || undefined,
        kind: "value" as const,
      };
    });
}

export function qeInsert(
  s: string,
  from: number,
  to: number,
  item: QuerySuggestion,
) {
  const text = s.slice(0, from) + item.insert + s.slice(to);
  return { text, caret: from + item.insert.length };
}

export function qePlatform(): string {
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const name = nav.userAgentData?.platform || nav.platform || "";
  return !name ? "" : /mac|iphone|ipad|ipod/i.test(name) ? "mac" : "pc";
}
