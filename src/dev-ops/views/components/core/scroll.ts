const stickLine = (head: HTMLElement) => {
  let box = head.parentElement?.parentElement ?? null;
  while (box && box !== document.body) {
    const cs = getComputedStyle(box);
    if (/(auto|scroll)/.test(cs.overflowY) && !box.matches(".gpa-table-scroll"))
      break;
    box = box.parentElement;
  }
  const ref = head.matches("thead") ? (head.querySelector("th") ?? head) : head;
  const top =
    parseFloat(getComputedStyle(ref).getPropertyValue("--gpa-head-top")) || 0;
  if (!box || box === document.body) return top;
  return (
    box.getBoundingClientRect().top +
    box.clientTop +
    (parseFloat(getComputedStyle(box).paddingTop) || 0) +
    top
  );
};

export const followHeader = (scroll: HTMLElement) => {
  const head =
    scroll.querySelector<HTMLElement>(".gpa-thead") ??
    scroll.querySelector<HTMLElement>(".gpa-htable > thead");
  if (!head) return;
  if (!scroll.classList.contains("is-scrolling")) {
    head.style.removeProperty("transform");
    return;
  }
  const r = scroll.getBoundingClientRect();
  const t = Math.max(
    0,
    Math.min(stickLine(head) - r.top, scroll.clientHeight - head.offsetHeight),
  );
  head.style.transform = t ? `translateY(${Math.round(t)}px)` : "";
};

export const watchScroll = (scroll: HTMLElement) => {
  if (typeof ResizeObserver === "undefined" || scroll.dataset.gpaWatched)
    return;
  scroll.dataset.gpaWatched = "";
  const check = () => {
    const fits = scroll.scrollWidth <= scroll.clientWidth + 1;
    scroll.classList.toggle("is-fitting", fits);
    scroll.classList.toggle("is-scrolling", !fits);
    if (fits) scroll.removeAttribute("tabindex");
    else scroll.tabIndex = 0;
    followHeader(scroll);
  };
  const ro = new ResizeObserver(check);
  ro.observe(scroll);
  const first = scroll.firstElementChild;
  if (first) ro.observe(first);
  check();
  const follow = () => followHeader(scroll);
  addEventListener("scroll", follow, { capture: true, passive: true });
  addEventListener("resize", follow);
};
