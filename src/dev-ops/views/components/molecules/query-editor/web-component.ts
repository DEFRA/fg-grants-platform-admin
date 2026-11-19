import { el, icon } from "../../core/dom.ts";
import { Layer } from "../../core/layer.ts";
import {
  qeCheck,
  qeInsert,
  qePaint,
  qePlatform,
  qeSuggest,
  qeValueItems,
  type QueryProblem,
  type QuerySuggestion,
  type QueryVocabulary,
} from "../../core/query.ts";

const ICONS: Record<string, string> = {
  field: "columns-3",
  function: "sigma",
  operator: "equal",
  value: "quote",
  keyword: "corner-down-left",
  source: "database",
  method: "square-function",
  stage: "list-filter",
};

export class GpaQueryEditor extends HTMLElement {
  #ta!: HTMLTextAreaElement;
  #root!: HTMLElement;
  #box!: HTMLElement;
  #hl!: HTMLElement;
  #mirror!: HTMLElement;
  #pop: HTMLElement | null = null;
  #layer: Layer | null = null;
  #vocab: QueryVocabulary = { sources: [] };
  #error: QueryProblem | null = null;
  #errorFor: string | null = null;
  #warn: QueryProblem | null = null;
  #open = false;
  #active = 0;
  #items: QuerySuggestion[] = [];
  #from = 0;
  #to = 0;
  #fetched: { key: string; items: QuerySuggestion[] } | null = null;
  #timer = 0;
  #valueTimer = 0;

  connectedCallback() {
    const root = this.querySelector<HTMLElement>(".gpa-qe");
    const ta = this.querySelector<HTMLTextAreaElement>(".gpa-qe-ta");
    if (!root || !ta || root.classList.contains("is-upgraded")) return;
    this.#root = root;
    this.#ta = ta;
    this.#box = ta.parentElement as HTMLElement;
    try {
      this.#vocab = JSON.parse(
        this.dataset.vocabulary ?? "",
      ) as QueryVocabulary;
    } catch {
      this.#vocab = { sources: [] };
    }
    try {
      this.#error = this.dataset.error
        ? (JSON.parse(this.dataset.error) as QueryProblem)
        : null;
    } catch {
      this.#error = null;
    }
    this.#errorFor = this.#error ? ta.value : null;
    this.#hl = el("pre", { className: "gpa-qe-hl", "aria-hidden": "true" });
    this.#mirror = el(
      "pre",
      { className: "gpa-qe-hl gpa-qe-mirror", "aria-hidden": "true" },
      "",
      el("span", {}, "​"),
    );
    this.#box.prepend(this.#hl, this.#mirror);
    ta.setAttribute("aria-autocomplete", "list");
    ta.setAttribute("aria-keyshortcuts", "Control+Enter Meta+Enter");
    root
      .querySelector<HTMLButtonElement>('[data-gpa-qe="copy"]')
      ?.addEventListener("click", (e) =>
        this.#copy(e.currentTarget as HTMLButtonElement),
      );
    root
      .querySelector<HTMLButtonElement>('[data-gpa-qe="clear"]')
      ?.addEventListener("click", () => {
        ta.value = "";
        this.#changed();
        this.#close();
        ta.focus();
      });
    this.#paint();
    root.classList.add("is-upgraded");
    let pasted = false;
    ta.addEventListener("paste", () => (pasted = true));
    ta.addEventListener("input", () => {
      this.#changed();
      if (pasted) this.#close();
      else this.#suggest(true);
      pasted = false;
    });
    const platform = qePlatform();
    if (platform) root.dataset.platform = platform;
    ta.addEventListener("keydown", (e) => this.#key(e));
    ta.addEventListener("click", () => this.#close());
    ta.addEventListener("blur", () => this.#close());
    ta.addEventListener("scroll", () => {
      this.#hl.style.transform =
        this.#mirror.style.transform = `translateY(${-ta.scrollTop}px)`;
      this.#layer?.place();
    });
  }

  #copy(button: HTMLButtonElement) {
    try {
      navigator.clipboard?.writeText(this.#ta.value).catch(() => {});
    } catch {}
    const word = button.querySelector("span:not(.gpa-vh)"),
      was = button.querySelector("svg"),
      said = word?.textContent ?? "";
    if (!word || said === "Copied") return;
    const tick = icon(this, "check", "sm");
    if (was && tick) was.replaceWith(tick);
    word.textContent = "Copied";
    setTimeout(() => {
      word.textContent = said;
      if (was && tick) tick.replaceWith(was);
    }, 1600);
  }

  get #problem() {
    return this.#error && this.#errorFor === this.#ta.value
      ? this.#error
      : this.#warn;
  }

  #changed() {
    const ta = this.#ta;
    ta.rows = Math.max(
      Number(ta.getAttribute("rows")) || 5,
      ta.value.split("\n").length + 1,
    );
    if (this.#error && this.#errorFor !== ta.value) {
      this.#error = null;
      ta.removeAttribute("aria-invalid");
    }
    this.#paint();
    clearTimeout(this.#timer);
    if (this.dataset.check === "false") return;
    this.#timer = window.setTimeout(() => {
      this.#warn = ta.value.trim() ? qeCheck(ta.value, this.#vocab) : null;
      this.#paint();
    }, 600);
  }

  #paint() {
    const problem = this.#problem,
      ta = this.#ta;
    const runs = qePaint(ta.value, this.#vocab, problem).map((r) => {
      const c = [r.cls && "gpa-qe-" + r.cls, r.err && "gpa-qe-err"]
        .filter(Boolean)
        .join(" ");
      return c ? el("span", { className: c }, r.text) : r.text;
    });
    this.#hl.replaceChildren(...runs, "\n");
    this.#root.classList.toggle("is-invalid", !!problem);
    const msgId = ta.id + "-msg";
    let msg = this.#root.querySelector<HTMLElement>(`#${CSS.escape(msgId)}`);
    const tone = problem
      ? problem === this.#error
        ? "error"
        : "warning"
      : null;
    if (!tone) msg?.remove();
    else {
      const next = el(
        "p",
        {
          id: msgId,
          className: "gpa-field-" + tone,
          role: tone === "error" ? "alert" : null,
        },
        icon(this, tone === "error" ? "circle-alert" : "triangle-alert", "sm"),
        problem!.message,
      );
      if (msg) msg.replaceWith(next);
      else this.#box.after(next);
      msg = next;
    }
    const desc = (ta.getAttribute("aria-describedby") ?? "")
      .split(/\s+/)
      .filter((x) => x && x !== msgId)
      .concat(tone ? [msgId] : []);
    if (desc.length) ta.setAttribute("aria-describedby", desc.join(" "));
    else ta.removeAttribute("aria-describedby");
  }

  #close() {
    this.#open = false;
    this.#hide();
    this.#ta.removeAttribute("aria-activedescendant");
    this.#ta.removeAttribute("aria-controls");
  }

  #suggest(reset: boolean) {
    const ta = this.#ta,
      caret = ta.selectionStart;
    const sug = qeSuggest(ta.value, caret, this.#vocab);
    let items = sug.items;
    this.#from = sug.from;
    this.#to = sug.to;
    clearTimeout(this.#valueTimer);
    const want = sug.values;
    const key = want ? [want.source, want.field, want.q].join("\u0000") : "";
    if (want && this.#fetched?.key === key) {
      if (this.#fetched.items.length)
        items = this.#fetched.items
          .concat(
            items.filter((x) => x.kind !== "value" || /^'\d{4}-/.test(x.label)),
          )
          .slice(0, 40);
    } else if (want && (this.dataset.valuesUrl || this.dataset.valuesAction)) {
      const post = this.dataset.valuesAction;
      const url = post ?? this.dataset.valuesUrl!;
      this.#valueTimer = window.setTimeout(async () => {
        try {
          const q = new URLSearchParams({
            source: want.source,
            field: want.field,
            q: want.q,
          });
          if (post)
            for (const f of this.#ta.form?.elements ?? [])
              if (
                f instanceof HTMLInputElement &&
                f.type === "hidden" &&
                f.name &&
                !q.has(f.name)
              )
                q.append(f.name, f.value);
          const res = await fetch(
            post ? url : url + (url.includes("?") ? "&" : "?") + q,
            {
              method: post ? "POST" : "GET",
              body: post ? q : undefined,
              headers: { Accept: "application/json" },
              credentials: "same-origin",
            },
          );
          if (!res.ok) throw new Error(String(res.status));
          const list = await res.json();
          this.#fetched = {
            key,
            items: qeValueItems(
              Array.isArray(list) ? list : (list.values ?? []),
            ),
          };
          if (this.#open || this.#ta === document.activeElement)
            this.#suggest(false);
        } catch {
          this.#fetched = { key, items: [] };
        }
      }, 150);
    }
    this.#items = items;
    if (reset) this.#active = 0;
    this.#open = true;
    this.#draw();
  }

  #draw() {
    const ta = this.#ta,
      id = ta.id,
      items = this.#items;
    if (!this.#open || !items.length) {
      this.#hide();
      ta.removeAttribute("aria-activedescendant");
      ta.removeAttribute("aria-controls");
      return;
    }
    this.#active = Math.min(this.#active, items.length - 1);
    const kbd = (t: string) =>
      el("kbd", { className: "gpa-kbd gpa-kbd-sm" }, t);
    const list = el("div", {
      className: "gpa-menu",
      role: "listbox",
      id: id + "-list",
      "aria-label": "Suggestions",
    });
    items.forEach((x, i) => {
      const opt = el(
        "div",
        {
          id: id + "-opt-" + i,
          role: "option",
          "aria-selected": String(i === this.#active),
          className:
            "gpa-menuitem gpa-qe-opt" +
            (i === this.#active ? " is-active" : ""),
        },
        icon(this, ICONS[x.kind] ?? "circle", "sm"),
        el("span", { className: "gpa-menuitem-label gpa-mono" }, x.label),
        x.detail
          ? el("span", { className: "gpa-menuitem-meta" }, x.detail)
          : null,
      );
      opt.addEventListener("mousedown", (e) => e.preventDefault());
      opt.addEventListener("mousemove", (e) => {
        if ((!e.movementX && !e.movementY) || this.#active === i) return;
        this.#active = i;
        this.#mark();
      });
      opt.addEventListener("click", () => this.#pick(x));
      list.append(opt);
    });
    const keys = el(
      "div",
      { className: "gpa-qe-keys", "aria-hidden": "true" },
      kbd("↑"),
      kbd("↓"),
      " move ",
      kbd("Tab"),
      " pick ",
      kbd("Esc"),
      " close",
    );
    const m = this.#mirror;
    (m.firstChild as Text).nodeValue = ta.value.slice(0, ta.selectionStart);
    const scroll = this.#pop?.querySelector(".gpa-menu")?.scrollTop ?? 0;
    if (this.#pop && this.#layer) {
      this.#pop.replaceChildren(list, keys);
      this.#layer.place();
    } else {
      this.#pop = el(
        "div",
        { className: "gpa-float gpa-qe-pop", "data-fit": "self" },
        list,
        keys,
      );
      this.#layer = new Layer(
        m.lastChild as HTMLElement,
        this.#pop,
        { side: "bottom", align: "start", gap: 2, minRows: 5 },
        () => this.#close(),
      );
      this.#layer.show();
    }
    list.scrollTop = scroll;
    list
      .querySelector<HTMLElement>(".is-active")
      ?.scrollIntoView?.({ block: "nearest" });
    ta.setAttribute("aria-controls", id + "-list");
    ta.setAttribute("aria-activedescendant", id + "-opt-" + this.#active);
  }

  #mark() {
    const list = this.#pop?.querySelector(".gpa-menu");
    if (!list) return;
    list.querySelectorAll<HTMLElement>(".gpa-qe-opt").forEach((o, i) => {
      o.classList.toggle("is-active", i === this.#active);
      o.setAttribute("aria-selected", String(i === this.#active));
    });
    list
      .querySelector<HTMLElement>(".is-active")
      ?.scrollIntoView?.({ block: "nearest" });
    this.#ta.setAttribute(
      "aria-activedescendant",
      this.#ta.id + "-opt-" + this.#active,
    );
  }

  #hide() {
    this.#layer?.hide();
    this.#layer = null;
    this.#pop = null;
  }

  disconnectedCallback() {
    this.#hide();
  }

  #pick(item: QuerySuggestion) {
    const ta = this.#ta;
    const r = qeInsert(ta.value, this.#from, this.#to, item);
    ta.value = r.text;
    ta.setSelectionRange(r.caret, r.caret);
    this.#changed();
    this.#suggest(true);
  }

  #key(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      this.#close();
      const run = new CustomEvent("gpa-run", {
        bubbles: true,
        cancelable: true,
        detail: { query: this.#ta.value },
      });
      if (this.dispatchEvent(run)) this.#ta.form?.requestSubmit();
      return;
    }
    if (e.ctrlKey && (e.key === " " || e.code === "Space") && !e.isComposing) {
      e.preventDefault();
      this.#suggest(true);
      return;
    }
    if (!this.#pop) return;
    const n = this.#items.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      this.#active = (this.#active + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
      this.#mark();
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      this.#pick(this.#items[this.#active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.#close();
    }
  }
}
