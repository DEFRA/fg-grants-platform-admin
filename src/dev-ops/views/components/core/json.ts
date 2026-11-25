export type CodeSeg = [cls: string, text: string];

const TOKEN =
  /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g;

const FRAME = /^\s*at\s/;
function stackLine(line: string): CodeSeg[] {
  if (!line) return [["", line]];
  if (!FRAME.test(line)) return [["msg", line]];
  if (/node:internal|node_modules|\(native\)|<anonymous>/.test(line))
    return [["int", line]];
  return [["app", line]];
}

export function codeLine(line: string, language?: string): CodeSeg[] {
  if (language === "stack") return stackLine(line);
  if (language !== "json") return [["", line]];
  const out: CodeSeg[] = [];
  const push = (cls: string, text: string): void => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last[0] === cls) last[1] += text;
    else out.push([cls, text]);
  };
  let at = 0;
  for (const m of line.matchAll(TOKEN)) {
    push("", line.slice(at, m.index));
    if (m[1]) {
      push(m[2] ? "key" : "str", m[1]);
      if (m[2]) push("", m[2]);
    } else if (m[3]) push("kw", m[3]);
    else push("num", m[4]);
    at = (m.index ?? 0) + m[0].length;
  }
  push("", line.slice(at));
  return out;
}

export const codeClass = (cls: string): string =>
  cls ? "gpa-code-" + cls : "";
