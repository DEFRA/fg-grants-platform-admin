import { place } from "../../core/floating.ts";

let count = 0;

export class GpaCutText extends HTMLElement {
  #tip: HTMLElement | null = null;
  #timer = 0;
  #observer: ResizeObserver | null = null;

  get value(): HTMLElement | null {
    return this.querySelector<HTMLElement>(".gpa-cut-text");
  }

  get link(): HTMLElement | null {
    return this.closest<HTMLElement>(".gpa-rowlink");
  }

  get cut(): boolean {
    const v = this.value;
    return (
      this.hasAttribute("data-size") ||
      (!!v && v.scrollWidth > v.clientWidth + 1)
    );
  }

  get text(): string {
    const size = this.dataset.size;
    const own = this.value?.textContent ?? "";
    return this.getAttribute("text") ?? (size ? `${own}… (${size})` : own);
  }

  connectedCallback() {
    const v = this.value;
    if (!v) return;
    const link = this.link;
    const measure = () => {
      if (this.cut && !link) v.setAttribute("tabindex", "0");
      else {
        v.removeAttribute("tabindex");
        if (!this.cut) this.hide();
      }
    };
    measure();
    if (typeof ResizeObserver !== "undefined") {
      this.#observer = new ResizeObserver(measure);
      this.#observer.observe(v);
    }
    const target = link ?? v;
    target.addEventListener("pointerenter", () => {
      window.clearTimeout(this.#timer);
      this.#timer = window.setTimeout(() => this.show(), 300);
    });
    target.addEventListener("pointerleave", () => this.hide());
    target.addEventListener("pointerdown", () => this.hide());
    target.addEventListener("focus", () => {
      try {
        if (target.matches(":focus-visible")) this.show();
      } catch {
        this.show();
      }
    });
    target.addEventListener("blur", () => this.hide());
    const open = (e: MouseEvent) => {
      if (e.button > 1 || String(window.getSelection?.() ?? "")) return;
      const a = this.closest(
        ".gpa-tr.is-link, tr.is-link",
      )?.querySelector<HTMLElement>(".gpa-rowlink");
      if (!a) return;
      e.stopPropagation();
      a.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
          button: e.button,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
        }),
      );
    };
    if (!link) {
      v.addEventListener("click", open);
      v.addEventListener("auxclick", (e) => {
        if (e.button === 1) open(e);
      });
    }
  }

  disconnectedCallback() {
    this.#observer?.disconnect();
    this.hide();
  }

  show() {
    window.clearTimeout(this.#timer);
    const v = this.value;
    if (!v || this.#tip || !this.cut) return;
    const tip = document.createElement("span");
    tip.className = "gpa-tooltip gpa-float gpa-cut-tip";
    tip.setAttribute("role", "tooltip");
    tip.setAttribute("aria-hidden", "true");
    tip.id = `gpa-cut-tip-${++count}`;
    tip.textContent = this.text;
    if ("showPopover" in tip) tip.setAttribute("popover", "manual");
    (this.closest("dialog[open]") ?? document.body).appendChild(tip);
    try {
      tip.showPopover?.();
    } catch {}
    place(v, tip, {
      side: (this.getAttribute("side") as "top" | "bottom") ?? "top",
      align: "center",
      gap: 6,
      fit: false,
    });
    this.#tip = tip;
    document.addEventListener("keydown", this.#onKey, true);
  }

  hide() {
    window.clearTimeout(this.#timer);
    document.removeEventListener("keydown", this.#onKey, true);
    this.#tip?.remove();
    this.#tip = null;
  }

  #onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") this.hide();
  };
}
