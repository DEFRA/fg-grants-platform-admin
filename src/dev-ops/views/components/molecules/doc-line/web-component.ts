import { el, parsePage } from "../../core/dom.ts";
import { oneLoad } from "../../core/one-load.ts";

export class GpaDocLine extends HTMLElement {
  #busy = false;

  connectedCallback() {
    const form = this.querySelector<HTMLFormElement>("form.gpa-docline-form");
    const group = this.querySelector<HTMLElement>(".gpa-docline");
    const button = form?.querySelector<HTMLButtonElement>("button");
    if (!form || !group || !button || this.dataset.gpaUp != null) return;
    this.dataset.gpaUp = "";
    button.setAttribute("aria-expanded", "false");
    form.addEventListener("submit", (e) => {
      if (this.dataset.gpaPlain != null) return;
      e.preventDefault();
      if (!this.#busy) void this.open(form, group, button);
    });
  }

  async open(form: HTMLFormElement, group: HTMLElement, button: HTMLElement) {
    this.#busy = true;
    const label = group.getAttribute("aria-label") ?? "the document";
    group.setAttribute("aria-busy", "true");
    group.querySelector(".gpa-docline-said")?.remove();
    const status = el(
      "span",
      { className: "gpa-vh", role: "status", "aria-live": "polite" },
      `Loading ${label}…`,
    );
    group.append(status);
    let item: HTMLElement | null = null;
    try {
      const body = new URLSearchParams(
        [...new FormData(form)].map(([k, v]) => [k, String(v)]),
      );
      const method = (form.getAttribute("method") ?? "post").toUpperCase();
      const action = form.getAttribute("action") || location.href;
      const res = await oneLoad(() =>
        fetch(
          method === "GET"
            ? action + (action.includes("?") ? "&" : "?") + body
            : action,
          {
            method,
            body: method === "GET" ? undefined : body,
            headers: {
              Accept: "text/html",
              "X-Requested-With": "gpa-doc-line",
            },
            credentials: "same-origin",
            redirect: "manual",
          },
        ),
      );
      if (res.type !== "opaqueredirect" && group.id) {
        const page = parsePage(await res.text());
        const theirs = page.getElementById(group.id);
        if (theirs?.classList.contains("gpa-docline"))
          item = document.importNode(theirs, true) as HTMLElement;
      }
    } catch {
      item = null;
    }
    this.#busy = false;
    status.remove();
    group.removeAttribute("aria-busy");
    if (item) {
      const details = item.querySelector<HTMLDetailsElement>("details");
      if (details) details.open = true;
      const wasFocused = document.activeElement === button;
      this.replaceWith(item);
      const caret = item.querySelector<HTMLElement>(".gpa-docline-row");
      if (wasFocused) caret?.focus();
      return;
    }
    this.dataset.gpaPlain = "";
    group.append(
      el(
        "p",
        { className: "gpa-docline-said", role: "status" },
        `${label} couldn't be opened here. Press it again to open it on its own page.`,
      ),
    );
  }
}
