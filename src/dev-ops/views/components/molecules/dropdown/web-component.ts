import { parsePage } from "../../core/dom.ts";
import { place, unplace } from "../../core/floating.ts";
import type { Placement } from "../../core/floating.ts";

const itemSelector =
  '[role^="menuitem"]:not([disabled]):not([aria-disabled="true"]), .gpa-menu-check > input:not(:disabled)';
const actionSelector = ".gpa-menu-actions :is(a[href], button:not([disabled]))";

const isOn = (item: HTMLElement) =>
  item.getAttribute("aria-checked") === "true" ||
  (item as HTMLInputElement).checked === true;

interface Parts {
  panel: HTMLElement;
  trigger: HTMLElement;
}

const moves: Record<string, (at: number, count: number) => number> = {
  ArrowDown: (at) => at + 1,
  ArrowUp: (at, count) => (at < 0 ? count - 1 : at - 1),
  Home: () => 0,
  End: (_at, count) => count - 1,
};

const show = (item: HTMLElement | undefined) => {
  item?.focus();
  item?.scrollIntoView?.({ block: "nearest" });
};

const partsOf = (element: HTMLElement): Parts | null => {
  const panel = element.querySelector<HTMLElement>(":scope > [popover][id]");

  if (!panel) {
    return null;
  }

  const trigger = element.querySelector<HTMLElement>(
    `[popovertarget="${CSS.escape(panel.id)}"]`,
  );

  return trigger ? { panel, trigger } : null;
};

export class GpaDropdown extends HTMLElement {
  #parts: Parts | null = null;
  #pending: string | null = null;
  #applying = false;

  connectedCallback() {
    queueMicrotask(() => this.enhance());
  }

  disconnectedCallback() {
    this.#unlisten();
  }

  enhance() {
    const parts = this.#parts ? null : partsOf(this);

    if (!parts) {
      return;
    }
    this.#parts = parts;
    parts.trigger.setAttribute("aria-expanded", "false");
    for (const item of this.#items()) {
      item.tabIndex = -1;
    }
    parts.panel.addEventListener(
      "onbeforetoggle" in HTMLElement.prototype ? "beforetoggle" : "toggle",
      this.#onToggle,
    );
    parts.panel.addEventListener("keydown", this.#onKey);
    parts.panel.addEventListener("click", this.#onTick);
    const apply = this.#apply();
    if (apply) {
      apply.disabled = true;
      parts.panel.addEventListener("change", () => {
        apply.disabled = !this.#changed();
      });
      apply.addEventListener("click", () => {
        this.#applying = true;
      });
    }
    parts.panel.addEventListener("pointerover", (event) => {
      const label = (event.target as Element).closest?.(
        ".gpa-menuitem-label",
      ) as HTMLElement | null;
      if (label && label.scrollWidth > label.clientWidth + 1)
        label.title = label.textContent?.trim() ?? "";
    });
  }

  get open() {
    return Boolean(this.#parts?.panel.matches(":popover-open"));
  }

  close(refocus?: boolean) {
    const parts = this.open ? this.#parts : null;

    if (!parts) {
      return;
    }
    parts.panel.hidePopover();
    if (refocus) {
      parts.trigger.focus();
    }
  }

  #apply = () =>
    this.#parts?.panel.querySelector<HTMLButtonElement>("[data-gpa-apply]") ??
    null;

  #checks = (): HTMLInputElement[] => [
    ...(this.#parts?.panel.querySelectorAll<HTMLInputElement>(
      '.gpa-menu-check > input[type="checkbox"]',
    ) ?? []),
  ];

  #changed = () => this.#checks().some((c) => c.checked !== c.defaultChecked);

  #items = (): HTMLElement[] => [
    ...(this.#parts?.panel.querySelectorAll<HTMLElement>(itemSelector) ?? []),
  ];

  #onToggle = (event: Event) => {
    if ((event as ToggleEvent).newState === "open") {
      requestAnimationFrame(() => {
        if (this.open) this.#opened();
      });
    } else {
      this.#closed();
    }
  };

  #opened() {
    const items = this.#items();

    this.#applying = false;
    this.#parts?.trigger.setAttribute("aria-expanded", "true");
    this.#reposition();
    window.addEventListener("scroll", this.#reposition, true);
    window.addEventListener("resize", this.#reposition);
    show(items.find(isOn) ?? items[0]);
  }

  #closed() {
    this.#parts?.trigger.setAttribute("aria-expanded", "false");
    if (this.#pending) {
      const href = this.#pending;
      this.#pending = null;
      location.assign(href);
    }
    if (!this.#applying) {
      for (const c of this.#checks()) c.checked = c.defaultChecked;
      const apply = this.#apply();
      if (apply) apply.disabled = true;
    }
    if (this.#parts) {
      unplace(this.#parts.panel);
    }
    this.#unlisten();
  }

  #onTick = async (event: MouseEvent) => {
    const item = (event.target as Element).closest?.<HTMLAnchorElement>(
      'a[role="menuitemcheckbox"][href]',
    );
    const panel = this.#parts?.panel;
    if (
      !item ||
      !panel ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.button > 0
    )
      return;
    event.preventDefault();
    const href = item.href,
      at = this.#items().indexOf(item);
    this.#pending = href;
    item.setAttribute(
      "aria-checked",
      String(item.getAttribute("aria-checked") !== "true"),
    );
    try {
      const res = await fetch(href, {
        headers: { Accept: "text/html" },
        credentials: "same-origin",
      });
      if (!res.ok || res.redirected) throw new Error(String(res.status));
      const page = parsePage(await res.text());
      const theirs = page.getElementById(panel.id);
      if (!theirs) throw new Error("no menu");
      if (this.#pending !== href) return;
      panel.replaceChildren(
        ...[...theirs.childNodes].map((n) => document.importNode(n, true)),
      );
      const value = page.querySelector(
        `[popovertarget="${CSS.escape(panel.id)}"] .gpa-chip-value`,
      );
      const mine = this.#parts?.trigger.querySelector(".gpa-chip-value");
      if (value && mine) mine.textContent = value.textContent;
      const items = this.#items();
      for (const i of items) i.tabIndex = -1;
      show(items[Math.min(at, items.length - 1)]);
    } catch {
      this.#pending = null;
      location.assign(href);
    }
  };

  #unlisten() {
    window.removeEventListener("scroll", this.#reposition, true);
    window.removeEventListener("resize", this.#reposition);
  }

  #placement(): Placement {
    return {
      side: this.dataset.placement === "top" ? "top" : "bottom",
      align: this.dataset.align === "end" ? "end" : "start",
    };
  }

  #reposition = () => {
    const parts = this.open ? this.#parts : null;

    if (parts) {
      place(parts.trigger, parts.panel, this.#placement());
    }
  };

  #onTab(event: KeyboardEvent) {
    const acts = [
      ...(this.#parts?.panel.querySelectorAll<HTMLElement>(actionSelector) ??
        []),
    ];
    const items = this.#items();
    const at = acts.indexOf(document.activeElement as HTMLElement);
    const inItems = items.includes(document.activeElement as HTMLElement);

    if (acts.length && inItems && !event.shiftKey) {
      event.preventDefault();
      acts[0].focus();
    } else if (at > 0 && event.shiftKey) {
      return;
    } else if (at >= 0 && at < acts.length - 1 && !event.shiftKey) {
      return;
    } else if (at === 0 && event.shiftKey && items.length) {
      event.preventDefault();
      show(items.find(isOn) ?? items[0]);
    } else {
      this.close();
    }
  }

  #onKey = (event: KeyboardEvent) => {
    if (event.key === "Tab") {
      this.#onTab(event);
      return;
    }
    if (
      event.key === "Enter" &&
      (event.target as HTMLInputElement).type === "checkbox"
    ) {
      event.preventDefault();
      (event.target as HTMLElement).click();
      return;
    }
    if (event.key === " ") {
      const item = (event.target as Element).closest?.<HTMLElement>(
        '[role="menuitemcheckbox"]',
      );
      if (item) {
        event.preventDefault();
        item.click();
        return;
      }
    }

    const move = moves[event.key];
    const items = this.#items();

    if (!move || !items.length) {
      return;
    }
    event.preventDefault();

    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = move(at, items.length);

    show(items[Math.max(0, Math.min(next, items.length - 1))]);
  };
}
