import { el } from "../../core/dom.ts";
import { codeClass, codeLine } from "../../core/json.ts";

export class GpaTextareaCode extends HTMLElement {
  #ta!: HTMLTextAreaElement;
  #pre!: HTMLPreElement;
  #errorLine = 0;
  #drawn: string[] = [];
  #marked = 0;
  #frame = 0;
  #dropped = false;

  connectedCallback() {
    const box = this.querySelector<HTMLElement>(".gpa-textarea-code");
    const ta = box?.querySelector<HTMLTextAreaElement>("textarea");
    if (!box || !ta) return;
    if (box.classList.contains("is-upgraded")) {
      if (this.#dropped && this.#pre) {
        this.#dropped = false;
        this.#paint();
      }
      return;
    }
    this.#ta = ta;
    this.#errorLine = Number(this.dataset.errorLine) || 0;
    this.#pre = el("pre");
    box.prepend(
      el(
        "div",
        { className: "gpa-textarea-hl", "aria-hidden": "true" },
        this.#pre,
      ),
    );
    this.#paint();
    box.classList.add("is-upgraded");
    ta.addEventListener("input", () => {
      this.#errorLine = 0;
      if (!this.#frame)
        this.#frame = requestAnimationFrame(() => {
          this.#frame = 0;
          this.#paint();
        });
    });
    ta.addEventListener("scroll", () => this.#sync());
  }

  disconnectedCallback() {
    if (this.#frame) {
      cancelAnimationFrame(this.#frame);
      this.#dropped = true;
    }
    this.#frame = 0;
  }

  #paint() {
    const language = this.dataset.language ?? "";
    const lines = this.#ta.value.split("\n");
    const rows = this.#pre.children;
    const marked = this.#errorLine;
    const shared = Math.min(lines.length, this.#drawn.length);
    for (let i = 0; i < shared; i++) {
      const was =
        this.#drawn[i] !== lines[i] ||
        (i + 1 === this.#marked) !== (i + 1 === marked);
      if (was)
        rows[i].replaceWith(this.#line(lines[i], language, i + 1 === marked));
    }
    if (rows.length > lines.length) {
      const tail = document.createRange();
      tail.setStartBefore(rows[lines.length]);
      tail.setEndAfter(this.#pre.lastChild!);
      tail.deleteContents();
    }
    if (lines.length > shared) {
      const more = document.createDocumentFragment();
      for (let i = shared; i < lines.length; i++)
        more.append(this.#line(lines[i], language, i + 1 === marked));
      this.#pre.append(more);
    }
    this.#drawn = lines;
    this.#marked = marked;
    this.#sync();
  }

  #line(line: string, language: string, error: boolean): HTMLSpanElement {
    const runs = (into: HTMLElement, text: string) => {
      for (const [cls, run] of codeLine(text, language)) {
        if (!run) continue;
        if (!cls) {
          into.append(run);
          continue;
        }
        const span = document.createElement("span");
        span.className = codeClass(cls);
        span.append(run);
        into.append(span);
      }
    };
    const out = document.createElement("span");
    if (!error) {
      runs(out, line);
      out.append("\n");
      return out;
    }
    const indent = /^\s*/.exec(line)?.[0] ?? "";
    const marked = document.createElement("span");
    marked.className =
      indent.length === line.length ? "is-error is-blank" : "is-error";
    runs(marked, line.slice(indent.length));
    if (indent) out.append(indent);
    out.append(marked, "\n");
    return out;
  }

  #sync() {
    this.#pre.style.transform = `translate(${-this.#ta.scrollLeft}px, ${-this.#ta.scrollTop}px)`;
  }
}
