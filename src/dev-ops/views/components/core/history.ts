const TRAIL = "gpa:trail";
const CUR = "gpa:cur";

type Trail = string[];

const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = sessionStorage.getItem(k);
      return v == null ? d : (JSON.parse(v) as T);
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    try {
      sessionStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

const listKey = (href: string): string | null => {
  try {
    const u = new URL(href, location.href);
    if (u.origin !== location.origin) return null;
    u.hash = "";
    u.searchParams.delete("through");
    u.searchParams.sort();
    return u.pathname + u.search;
  } catch {
    return null;
  }
};

const state = (): Record<string, unknown> =>
  history.state && typeof history.state === "object"
    ? (history.state as Record<string, unknown>)
    : {};
const setState = (patch: Record<string, unknown>) => {
  try {
    history.replaceState({ ...state(), ...patch }, "");
  } catch {}
};

const main = () => document.querySelector<HTMLElement>("main.gpa-main");

let index = -1;

function enter() {
  const trail = store.get<Trail>(TRAIL, []);
  const kept = state().gpaIdx;
  if (typeof kept === "number") index = kept;
  else {
    index = store.get<number>(CUR, -1) + 1;
    trail.length = Math.min(trail.length, index);
    setState({ gpaIdx: index });
  }
  trail[index] = location.href;
  store.set(TRAIL, trail);
  store.set(CUR, index);
}

function moved() {
  const trail = store.get<Trail>(TRAIL, []);
  const kept = state().gpaIdx;
  if (typeof kept === "number") index = kept;
  else {
    index += 1;
    trail.length = Math.min(trail.length, index);
    setState({ gpaIdx: index });
  }
  trail[index] = location.href;
  store.set(TRAIL, trail);
  store.set(CUR, index);
}

function leave() {
  if (index < 0) return;
  const trail = store.get<Trail>(TRAIL, []);
  trail[index] = location.href;
  store.set(TRAIL, trail);
}

function backLinks() {
  document.addEventListener("click", (e) => {
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    )
      return;
    const a = (e.target as Element).closest?.<HTMLAnchorElement>(
      "a.gpa-backlink[href]",
    );
    if (!a || index <= 0) return;
    const want = listKey(a.href);
    if (!want) return;
    const trail = store.get<Trail>(TRAIL, []);
    for (let i = index - 1; i >= 0; i--) {
      if (trail[i] && listKey(trail[i]) === want) {
        e.preventDefault();
        history.go(i - index);
        return;
      }
    }
  });
}

function keepScroll() {
  let t = 0;
  document.addEventListener(
    "scroll",
    (e) => {
      const m = main();
      if (!m || e.target !== m) return;
      window.clearTimeout(t);
      t = window.setTimeout(
        () => setState({ gpaMainScroll: m.scrollTop }),
        120,
      );
    },
    true,
  );
}

function restoreScroll() {
  const nav = performance.getEntriesByType?.("navigation")[0] as
    PerformanceNavigationTiming | undefined;
  const again = nav && (nav.type === "back_forward" || nav.type === "reload");
  const m = main();
  if (!m) return;
  const at = state().gpaMainScroll;
  if (again && typeof at === "number") {
    const put = () => {
      m.scrollTop = at;
    };
    if (document.readyState === "complete") put();
    else window.addEventListener("load", put, { once: true });
    requestAnimationFrame(put);
    return;
  }
  const id = location.hash.slice(1);
  const row = id ? document.getElementById(decodeURIComponent(id)) : null;
  if (row && m.contains(row))
    requestAnimationFrame(() => row.scrollIntoView({ block: "center" }));
}

let started = false;
export function keepPlace() {
  if (started || typeof window === "undefined") return;
  started = true;
  enter();
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) {
      const kept = state().gpaIdx;
      if (typeof kept === "number") index = kept;
      store.set(CUR, index);
    }
  });
  window.addEventListener("pagehide", leave);
  window.addEventListener("popstate", moved);
  window.addEventListener("hashchange", moved);
  backLinks();
  keepScroll();
  restoreScroll();
}
