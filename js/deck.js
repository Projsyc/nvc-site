(() => {
  const deck = document.getElementById("deck");
  if (!deck) return;

  const slides = [...deck.querySelectorAll(".slide")];
  if (!slides.length) return;

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const root = document.documentElement;
  const HASH_ALIAS = { mesh: "hero" };

  let index = 0;
  let hashLock = false;
  let hashLockTimer = 0;

  function slideIndex(id) {
    return slides.findIndex((s) => s.id === (HASH_ALIAS[id] || id));
  }

  function fromHash() {
    const raw = location.hash.replace(/^#/, "");
    const id = HASH_ALIAS[raw] || raw;
    if (raw && HASH_ALIAS[raw] && location.hash !== `#${id}`) {
      history.replaceState(null, "", `#${id}`);
    }
    const i = id ? slideIndex(id) : 0;
    return i >= 0 ? i : 0;
  }

  function syncChrome() {
    const id = slides[index] && slides[index].id;
    $$(".nav-links a, .pager a").forEach((a) => {
      const href = a.getAttribute("href") || "";
      a.classList.toggle("is-here", href === `#${id}`);
    });
    slides.forEach((s, i) => s.classList.toggle("is-current", i === index));
  }

  function loading() {
    return root.classList.contains("is-loading");
  }

  function goTo(next, { instant = false, hash = true } = {}) {
    next = clamp(next, 0, slides.length - 1);
    const el = slides[next];
    if (!el) return;
    index = next;
    syncChrome();
    if (hash && el.id) {
      hashLock = true;
      history.replaceState(null, "", `#${el.id}`);
      clearTimeout(hashLockTimer);
      hashLockTimer = setTimeout(() => { hashLock = false; }, 700);
    }
    const behavior = reduced || instant ? "auto" : "smooth";
    if (next === 0 || el.id === "hero") {
      scrollTo({ top: 0, behavior });
      return;
    }
    el.scrollIntoView({
      behavior,
      block: "start",
    });
  }

  function closestIndex() {
    const mark = innerHeight * 0.32;
    if (drawer && drawer.getBoundingClientRect().top > mark) return 0;
    let best = 0;
    let bestDist = Infinity;
    slides.forEach((s, i) => {
      if (s.id === "hero") return;
      const d = Math.abs(s.getBoundingClientRect().top - mark);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  }

  const atomWrap = document.querySelector(".hero-orbit-wrap");
  const drawer = document.getElementById("drawer");
  const heroSlide = slides.find((s) => s.id === "hero") || slides[0];

  function coverAmount() {
    if (!drawer) return 0;
    const top = drawer.getBoundingClientRect().top;
    return clamp(1 - top / Math.max(1, innerHeight), 0, 1);
  }

  function easeIn(t) {
    return t * t;
  }

  function tickScroll() {
    const cover = coverAmount();
    const globeT = clamp((cover - 0.04) / 0.7, 0, 1);
    const chromeT = clamp(cover / 0.36, 0, 1);
    root.style.setProperty("--hero-out", cover.toFixed(4));
    root.style.setProperty("--globe-out", easeIn(globeT).toFixed(4));
    root.style.setProperty("--hero-chrome-out", (chromeT * chromeT * (3 - 2 * chromeT)).toFixed(4));

    const past = atomWrap && atomWrap.classList.contains("is-past");
    const covered = cover > (past ? 0.84 : 0.9);
    if (atomWrap) {
      atomWrap.classList.toggle("is-away", cover > 0.18);
      atomWrap.classList.toggle("is-past", covered);
    }
    if (heroSlide) {
      heroSlide.classList.toggle("is-leaving", cover > 0.1);
      heroSlide.classList.toggle("is-covered", covered);
      if (covered) heroSlide.setAttribute("inert", "");
      else heroSlide.removeAttribute("inert");
    }

    if (hashLock || loading()) return;
    const next = closestIndex();
    if (next === index) return;
    index = next;
    syncChrome();
    const id = slides[index].id;
    if (id && location.hash !== `#${id}`) {
      history.replaceState(null, "", `#${id}`);
    }
  }

  let ticking = false;
  function requestTick() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      tickScroll();
    });
  }
  addEventListener("scroll", requestTick, { passive: true });
  addEventListener("resize", requestTick);

  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    if (loading()) { e.preventDefault(); return; }
    const id = (a.getAttribute("href") || "").slice(1);
    const i = slideIndex(id);
    if (i < 0) return;
    e.preventDefault();
    goTo(i);
  });

  addEventListener("keydown", (e) => {
    if (loading()) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
    if (e.key === "Home") {
      e.preventDefault();
      goTo(0);
    } else if (e.key === "End") {
      e.preventDefault();
      goTo(slides.length - 1);
    }
  });

  addEventListener("hashchange", () => {
    const raw = location.hash.replace(/^#/, "");
    const i = fromHash();
    if (i !== index) goTo(i, { hash: false, instant: !!HASH_ALIAS[raw] });
  });

  function afterLoad(fn) {
    if (!loading()) {
      fn();
      return;
    }
    const obs = new MutationObserver(() => {
      if (!loading()) {
        obs.disconnect();
        fn();
      }
    });
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
  }

  index = fromHash();
  syncChrome();
  afterLoad(() => {
    goTo(fromHash(), { instant: true, hash: false });
    tickScroll();
  });
})();
