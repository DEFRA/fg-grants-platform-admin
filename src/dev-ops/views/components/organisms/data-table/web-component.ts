import { watchScroll } from "../../core/scroll.ts";

export class GpaDataTable extends HTMLElement {
  connectedCallback() {
    const scroll = this.querySelector<HTMLElement>(".gpa-table-scroll");
    if (!scroll) return;
    const cols = this.dataset.cols;
    if (cols) {
      scroll.style.setProperty("--gpa-cols", cols);
      const narrow =
        scroll.dataset.gpaColsNarrow ??
        cols
          .split(/\s+(?![^(]*\))/)
          .filter((t) => t !== "var(--size-column-chevron)")
          .map((t) => (t === "var(--size-column-check)" ? t : "auto"))
          .join(" ");
      scroll.style.setProperty("--gpa-cols-narrow", narrow);
    }
    if (this.hasAttribute("data-sticky")) {
      const stick = () => {
        for (const row of scroll.querySelectorAll("tbody .gpa-tr")) {
          const cells = [...row.children].filter(
            (c) => !c.classList.contains("gpa-cell-check"),
          );
          cells[0]?.classList.add("gpa-sticky-col");
          if (this.hasAttribute("data-selectable"))
            cells[0]?.classList.add("gpa-sticky-after-check");
          row.querySelector(".gpa-cell-check")?.classList.add("gpa-sticky-col");
        }
      };
      stick();
      const body = scroll.querySelector("tbody");
      if (body) new MutationObserver(stick).observe(body, { childList: true });
      const open = (event: MouseEvent) => {
        const t = event.target as Element;
        const row = t.closest(".gpa-tr.is-link");
        if (!row || t.closest("a, button, input, label, select, textarea"))
          return;
        if (String(window.getSelection?.() ?? "")) return;
        const link = row.querySelector<HTMLAnchorElement>("a.gpa-rowlink");
        if (!link) return;
        if (
          event.button === 1 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey
        ) {
          event.preventDefault();
          window.open(link.href, "_blank", "noopener");
        } else if (event.button === 0) link.click();
      };
      scroll.addEventListener("click", open);
      scroll.addEventListener("auxclick", open);
    }
    watchScroll(scroll);
    const toolbar = this.querySelector<HTMLElement>(".gpa-table-toolbar");
    const frame = toolbar?.parentElement;
    if (toolbar && frame && typeof ResizeObserver !== "undefined")
      new ResizeObserver(() =>
        frame.style.setProperty("--gpa-toolbar-h", `${toolbar.offsetHeight}px`),
      ).observe(toolbar);
    this.addEventListener("mouseover", (event) => {
      const link = (event.target as Element).closest<HTMLElement>(
        ".gpa-rowlink",
      );
      if (!link || link.querySelector(".gpa-cut")) return;
      if (link.scrollWidth > link.clientWidth + 1)
        link.title ||= link.textContent?.trim() ?? "";
    });
    if (this.hasAttribute("data-selectable")) this.#selection();
  }

  #selection() {
    const all = this.querySelector<HTMLInputElement>("input[data-gpa-all]");
    const rows = () => [
      ...this.querySelectorAll<HTMLInputElement>("input[data-gpa-row]"),
    ];
    const bar = this.querySelector<HTMLElement>(".gpa-bulkbar");
    const sync = () => {
      const boxes = rows();
      const on = boxes.filter((b) => b.checked);
      for (const b of boxes) {
        const tr = b.closest("tr");
        tr?.classList.toggle("is-selected", b.checked);
        tr?.setAttribute("aria-selected", String(b.checked));
      }
      if (all) {
        all.checked = boxes.length > 0 && on.length === boxes.length;
        all.indeterminate = on.length > 0 && on.length < boxes.length;
        all.disabled = boxes.length === 0;
        const tick = all.parentElement?.querySelector("svg");
        if (tick) tick.style.display = "";
      }
      if (bar) {
        bar.hidden = on.length === 0;
        const text = `${on.length} selected`;
        bar.setAttribute("aria-label", text);
        const count = bar.querySelector(".gpa-bulkbar-count");
        if (count) count.textContent = text;
      }
      this.dispatchEvent(
        new CustomEvent("gpa-selection", {
          detail: { ids: on.map((b) => b.value) },
          bubbles: true,
        }),
      );
    };
    this.addEventListener("change", (event) => {
      const t = event.target as HTMLInputElement;
      if (t === all) for (const b of rows()) b.checked = all.checked;
      if (t === all || t.hasAttribute("data-gpa-row")) sync();
    });
    bar?.querySelector("[data-gpa-clear]")?.addEventListener("click", () => {
      for (const b of rows()) b.checked = false;
      sync();
    });
    sync();
  }
}
