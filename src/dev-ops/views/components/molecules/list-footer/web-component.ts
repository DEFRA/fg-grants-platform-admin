import { el, parsePage } from "../../core/dom.ts";

const ARRIVAL_INPUT = ["wheel", "touchstart", "keydown", "pointerdown"];

const keepRow = (body: HTMLElement) => {
  if (body.dataset.gpaKeepRow != null) return;
  body.dataset.gpaKeepRow = "";
  body.addEventListener(
    "click",
    (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const t = e.target as Element;
      const row = t.closest?.<HTMLElement>("tr[id], .gpa-tr[id]");
      const own = row?.getAttribute("data-restore-href");
      const at = own
        ? new URL(own, location.href).href
        : body.dataset.gpaRestored;
      if (!at || !row || !t.closest("a[href]")) return;
      const u = new URL(at);
      if (u.origin !== location.origin) return;
      u.hash = row.id;
      history.replaceState(history.state, "", u.href);
    },
    true,
  );
};

export class GpaLoadMore extends HTMLElement {
  #observer: IntersectionObserver | null = null;
  #busy = false;

  connectedCallback() {
    const link = this.querySelector<HTMLAnchorElement>("a[data-gpa-more]");
    const form = this.querySelector<HTMLFormElement>("form");
    if ((!link && !form) || this.dataset.gpaUp != null) return;
    this.dataset.gpaUp = "";
    link?.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0 || !this.#body)
        return;
      e.preventDefault();
      this.load(true);
    });
    form?.addEventListener("submit", (e) => {
      if (!this.#body) return;
      e.preventDefault();
      this.load(true);
    });
    if (
      this.dataset.auto !== "false" &&
      typeof IntersectionObserver !== "undefined"
    ) {
      this.#observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((x) => x.isIntersecting)) this.load(false);
        },
        { rootMargin: "0px 0px 320px 0px" },
      );
      const hash = decodeURIComponent(location.hash.slice(1));
      if (hash && document.getElementById(hash)) {
        const start = () => {
          for (const t of ARRIVAL_INPUT) removeEventListener(t, start, true);
          this.#observer?.observe(this);
        };
        for (const t of ARRIVAL_INPUT)
          addEventListener(t, start, { capture: true, passive: true });
      } else this.#observer.observe(this);
    }
  }

  disconnectedCallback() {
    this.#observer?.disconnect();
    this.#observer = null;
  }

  get #href() {
    return (
      this.querySelector<HTMLAnchorElement>("a[data-gpa-more]")?.href ??
      this.querySelector<HTMLFormElement>("form")?.action ??
      this.dataset.href ??
      ""
    );
  }

  #post: URLSearchParams | null = null;

  get #body(): HTMLElement | null {
    return (
      this.closest(".gpa-table")?.querySelector<HTMLElement>(
        "tbody, .gpa-table-body",
      ) ?? null
    );
  }

  #footer(content: (Node | string)[], attrs: Record<string, string> = {}) {
    const foot = this.querySelector<HTMLElement>(".gpa-listfoot");
    if (!foot) return;
    for (const a of ["role", "aria-live"]) foot.removeAttribute(a);
    for (const [k, v] of Object.entries(attrs)) foot.setAttribute(k, v);
    foot.replaceChildren(...content);
  }

  #count(body: HTMLElement, page: DocumentFragment, theirs: Element) {
    const sel = "[data-load-more-count]";
    const scope = (n: Element) =>
      n.closest(".gpa-listpage") ?? n.closest(".gpa-table");
    const id = this.dataset.countId;
    const mine = id
      ? [document.getElementById(id)].filter(Boolean)
      : [...(scope(body)?.querySelectorAll<HTMLElement>(sel) ?? [])];
    const theirsAll = id
      ? [page.getElementById(id)]
      : [...(scope(theirs)?.querySelectorAll<HTMLElement>(sel) ?? [])];
    mine.forEach((m, i) => {
      const t = (m!.id && page.getElementById(m!.id)) || theirsAll[i];
      if (t)
        m!.replaceChildren(
          ...[...t.childNodes].map((n) => document.importNode(n, true)),
        );
    });
  }

  async load(byHand: boolean) {
    const href = this.#href;
    const body = this.#body;
    if (this.#busy || !href || !body) return;
    this.#busy = true;
    this.dataset.href = href;
    const form = this.querySelector<HTMLFormElement>("form");
    if (form)
      this.#post = new URLSearchParams(
        [...new FormData(form)].map(([k, v]) => [k, String(v)]),
      );
    const noun = this.dataset.noun ?? "records";
    this.#footer(
      [
        el("span", {
          className: "gpa-spinner gpa-spinner-sm",
          "aria-hidden": "true",
        }),
        `Loading more ${noun}…`,
      ],
      { "aria-live": "polite" },
    );
    try {
      const res = await fetch(href, {
        method: this.#post ? "POST" : "GET",
        body: this.#post ?? undefined,
        headers: { Accept: "text/html", "X-Requested-With": "gpa-load-more" },
        credentials: "same-origin",
      });
      const away = res.redirected
        ? res.url
        : (res.status === 409 || res.status === 410) &&
          res.headers.get("Location");
      if (away) {
        location.assign(new URL(away, href).href);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const page = parsePage(await res.text());
      const theirs =
        (body.id && page.getElementById(body.id)) ||
        page.querySelector(".gpa-table tbody, .gpa-table .gpa-table-body");
      if (!theirs) {
        location.assign(res.url || href);
        return;
      }
      const rows = [...theirs.children].map(
        (r) => document.importNode(r, true) as HTMLElement,
      );
      const stamp = (list: Element[], at: string | null, base: string) => {
        if (!at) return;
        const abs = new URL(at, base).href;
        for (const r of list)
          if (!r.hasAttribute("data-restore-href"))
            r.setAttribute("data-restore-href", abs);
      };
      stamp(
        [...body.children],
        body.getAttribute("data-restore-href"),
        location.href,
      );
      stamp(rows, theirs.getAttribute("data-restore-href"), res.url || href);
      body.append(...rows);
      this.#count(body, page, theirs);
      const next = theirs
        .closest(".gpa-table")
        ?.querySelector("gpa-load-more, .gpa-listfoot");
      const restore = next
        ?.closest(".gpa-table")
        ?.querySelector("[data-restore-href]")
        ?.getAttribute("data-restore-href");
      if (restore) {
        const to = new URL(restore, res.url || href);
        if (to.origin === location.origin) {
          history.replaceState(history.state, "", to.href);
          body.dataset.gpaRestored = to.href;
          keepRow(body);
        }
      }
      this.#observer?.disconnect();
      this.#busy = false;
      if (next) this.replaceWith(document.importNode(next, true));
      else this.remove();
      if (byHand && rows[0]) {
        const target =
          rows[0].querySelector<HTMLElement>(
            "a[href], button:not([disabled])",
          ) ?? rows[0];
        if (target === rows[0] && !rows[0].hasAttribute("tabindex"))
          rows[0].tabIndex = -1;
        target.focus();
      }
      body.dispatchEvent(
        new CustomEvent("gpa-load", { bubbles: true, detail: { rows } }),
      );
    } catch {
      this.#busy = false;
      const retry = el(
        "button",
        { type: "button", className: "gpa-btn gpa-btn-default gpa-btn-sm" },
        el("span", {}, "Retry"),
      );
      retry.addEventListener("click", () => this.load(true));
      this.#footer(
        [
          el(
            "span",
            { className: "gpa-text-danger" },
            `Couldn’t load more ${noun}.`,
          ),
          retry,
        ],
        { role: "alert" },
      );
    }
  }
}
