(() => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const touch = matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
  if (touch) document.body.classList.add("touch");

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  const NODES = {
    tokyo: {
      title: "EDGE · TOKYO · STANDBY",
      copy: "Planned Japan edge for static delivery and cache. It shortens the Asia-Pacific hop without moving origin compute away from Los Angeles.",
      facts: [
        ["ROLE", "CDN EDGE"],
        ["REGION", "TYO / JST"],
        ["STATUS", "STANDBY"],
        ["ROUTE", "TYO → LAX"],
      ],
      term: "> edge.tyo status\nSTANDBY\n> route\ntyo → core.lax",
    },
    seoul: {
      title: "EDGE · SEOUL · STANDBY",
      copy: "Planned South Korea edge for a second Northeast Asia route. It shares the same Los Angeles origin and remains independent of the Tokyo node.",
      facts: [
        ["ROLE", "CDN EDGE"],
        ["REGION", "SEL / KST"],
        ["STATUS", "STANDBY"],
        ["ROUTE", "SEL → LAX"],
      ],
      term: "> edge.sel status\nSTANDBY\n> route\nsel → core.lax",
    },
    hongkong: {
      title: "EDGE · HONG KONG, CHINA · STANDBY",
      copy: "Planned Hong Kong, China edge for an East Asia coastal handoff. It is a cache and relay layer; origin compute remains in Los Angeles.",
      facts: [
        ["ROLE", "CDN EDGE"],
        ["REGION", "HKG / HKT"],
        ["STATUS", "STANDBY"],
        ["ROUTE", "HKG → LAX"],
      ],
      term: "> edge.hkg status\nSTANDBY\n> region\nhong kong · china\n> route\nhkg → core.lax",
    },
    core: {
      title: "CORE · LOS ANGELES",
      copy: "Origin compute. Ubuntu + Docker. Public 443 is nginx stream by SNI; HTTP sites egress through a Cloudflare tunnel. Workload containers bind loopback only.",
      facts: [
        ["ROLE", "ORIGIN"],
        ["REGION", "LAX / PDT"],
        ["STATUS", "PROBE"],
        ["BORN", "2026-08-02"],
      ],
      term: "> probe core.lax\nawaiting telemetry\n> ingress\n443/sni · cloudflare tunnel",
    },
  };

  const PILL = {
    live: { cls: "pill live", text: "LIVE" },
    down: { cls: "pill down", text: "DOWN" },
    standby: { cls: "pill wait", text: "STANDBY" },
    private: { cls: "pill private", text: "PRIVATE" },
    loopback: { cls: "pill private", text: "LOOPBACK" },
    probe: { cls: "pill wait", text: "PROBE" },
  };

  let lastStatus = null;
  let lastRtt = null;
  let selectedNode = "core";
  let hostUptimeSec = null;
  let lastTelemetryTs = null;
  const HISTORY_POINTS = 13;
  const PROBE_INTERVAL_MS = 60_000;
  const telemetryHistory = { cpu: [], gpu: [], mem: [], disk: [], temp: [] };

  /* ---------- load ---------- */
  const LOAD_KEY = "nvc.mesh.ready";
  const root = document.documentElement;
  let loadDone = false;

  function loadSkipped() {
    if (reduced) return true;
    try { return sessionStorage.getItem(LOAD_KEY) === "1"; } catch { return false; }
  }

  function finishLoad() {
    if (loadDone) return;
    loadDone = true;
    try { sessionStorage.setItem(LOAD_KEY, "1"); } catch {}
    const showed = root.classList.contains("is-loading");
    root.classList.remove("is-loading");
    root.classList.add("is-ready");
    if (showed) root.classList.add("was-loading");
  }

  function runLoad() {
    if (loadSkipped() || !root.classList.contains("is-loading")) {
      finishLoad();
      return;
    }
    const t0 = performance.now();
    const done = () => {
      const wait = Math.max(0, 80 - (performance.now() - t0));
      setTimeout(finishLoad, wait);
    };
    if (document.readyState === "complete") done();
    else addEventListener("load", done, { once: true });
    setTimeout(finishLoad, 400);
  }

  runLoad();

  /* ---------- clocks / uptime ---------- */
  const born = Date.parse("2026-08-02T00:00:00Z");
  function pad(n) { return String(n).padStart(2, "0"); }
  function tickClocks() {
    $$("[data-clock]").forEach((el) => {
      const tz = el.dataset.tz;
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      }).format(new Date());
      el.textContent = `${el.dataset.clock} ${parts}`;
    });
    const up = $("#uptime");
    if (up) {
      if (hostUptimeSec != null) hostUptimeSec += 1;
      const sec = hostUptimeSec != null ? hostUptimeSec : Math.max(0, Math.floor((Date.now() - born) / 1000));
      up.textContent = `UP ${fmtUptime(sec)}`;
    }
  }
  tickClocks();
  setInterval(tickClocks, 1000);

  /* ---------- magnetic ---------- */
  if (!touch && !reduced) {
    $$("[data-magnetic]").forEach((el) => {
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / 6;
        const dy = (e.clientY - (r.top + r.height / 2)) / 6;
        el.style.transform = `translate(${dx}px, ${dy}px)`;
      });
      el.addEventListener("pointerleave", () => { el.style.transform = ""; });
    });
  }

  /* ---------- card tilt ---------- */
  if (!touch && !reduced) {
    $$(".tilt").forEach((el) => {
      el.addEventListener("pointermove", (e) => {
        if (e.buttons) return;
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        el.style.setProperty("--rx", `${(0.5 - py) * 8}deg`);
        el.style.setProperty("--ry", `${(px - 0.5) * 10}deg`);
        el.style.setProperty("--lift", "-4px");
      });
      el.addEventListener("pointerleave", () => {
        el.style.setProperty("--rx", "0deg");
        el.style.setProperty("--ry", "0deg");
        el.style.setProperty("--lift", "0px");
      });
    });
  }

  /* ---------- services rail ---------- */
  (function initServiceRail() {
    const rail = $("#svcRail");
    const thumb = $("#svcMeterThumb");
    if (!rail) return;

    const cards = $$(".card", rail);
    const track = rail.querySelector(".cards");
    cards.forEach((card) => { card.draggable = false; });
    const maxScroll = () => Math.max(0, rail.scrollWidth - rail.clientWidth);
    const stackInPlay = () => {
      const slide = document.getElementById("stack");
      return !!(slide && slide.classList.contains("is-current"));
    };
    const overCard = (e) => {
      const node = e.target && (e.target.nodeType === 1 ? e.target : e.target.parentElement);
      return !!(node && node.closest && node.closest("#svcRail .card"));
    };
    let dragLeft = null;

    function paint() {
      const railR = rail.getBoundingClientRect();
      const viewMid = railR.left + railR.width / 2;
      let best = 0;
      let bestDist = Infinity;
      cards.forEach((card, i) => {
        const r = card.getBoundingClientRect();
        const dist = Math.abs(r.left + r.width / 2 - viewMid);
        const t = 1 - Math.min(1, dist / Math.max(1, r.width * 0.9));
        card.style.setProperty("--focus", t.toFixed(3));
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      });
      cards.forEach((card, i) => {
        const on = i === best;
        card.classList.toggle("is-focus", on);
        if (on) card.setAttribute("aria-current", "true");
        else card.removeAttribute("aria-current");
      });
      if (thumb) {
        const max = maxScroll();
        const ratio = rail.scrollWidth > 0 ? rail.clientWidth / rail.scrollWidth : 1;
        const thumbPct = clamp(ratio, 0.14, 0.5);
        const travel = 1 - thumbPct;
        const left = dragLeft == null ? rail.scrollLeft : dragLeft;
        const x = max > 0 ? (left / max) * travel : 0;
        thumb.style.width = `${(thumbPct * 100).toFixed(2)}%`;
        thumb.style.transform = `translateX(${((x / thumbPct) * 100).toFixed(2)}%)`;
      }
    }

    function centerCard(card, instant = false) {
      const r = card.getBoundingClientRect();
      const railR = rail.getBoundingClientRect();
      const delta = r.left + r.width / 2 - (railR.left + railR.width / 2);
      rail.scrollBy({
        left: delta,
        behavior: instant || reduced ? "auto" : "smooth",
      });
    }

    function step(dir) {
      const i = cards.findIndex((c) => c.classList.contains("is-focus"));
      const next = cards[clamp(i + dir, 0, cards.length - 1)];
      if (next) centerCard(next);
    }

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        paint();
      });
    };
    rail.addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", paint);

    let dragged = false;
    let dragging = false;
    let startX = 0;
    let startLeft = 0;
    let pointerId = 0;
    let snapTimer = 0;

    function clearTilt() {
      cards.forEach((card) => {
        card.style.setProperty("--rx", "0deg");
        card.style.setProperty("--ry", "0deg");
        card.style.setProperty("--lift", "0px");
      });
    }

    rail.addEventListener("dragstart", (e) => e.preventDefault());
    rail.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch" || e.button !== 0) return;
      dragging = true;
      dragged = false;
      startX = e.clientX;
      startLeft = rail.scrollLeft;
      dragLeft = startLeft;
      pointerId = e.pointerId;
      clearTimeout(snapTimer);
    });
    rail.addEventListener("pointermove", (e) => {
      if (!dragging || e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      if (!dragged && Math.abs(dx) > 6) {
        dragged = true;
        clearTilt();
        rail.classList.add("is-drag");
        try { rail.setPointerCapture(e.pointerId); } catch {}
      }
      if (!dragged || !track) return;
      e.preventDefault();
      dragLeft = clamp(startLeft - dx, 0, maxScroll());
      track.style.transform = `translate3d(${startLeft - dragLeft}px, 0, 0)`;
      paint();
    }, { passive: false });
    const endDrag = (e) => {
      if (!dragging || (e && e.pointerId !== pointerId)) return;
      dragging = false;
      if (track) track.style.transform = "";
      if (dragged && dragLeft != null) rail.scrollLeft = dragLeft;
      dragLeft = null;
      if (!dragged) {
        rail.classList.remove("is-drag");
        return;
      }
      paint();
      const on = cards.find((c) => c.classList.contains("is-focus"));
      if (on) centerCard(on);
      clearTimeout(snapTimer);
      snapTimer = setTimeout(() => rail.classList.remove("is-drag"), reduced ? 0 : 420);
    };
    rail.addEventListener("pointerup", endDrag);
    rail.addEventListener("pointercancel", endDrag);

    rail.addEventListener("click", (e) => {
      if (dragged) {
        e.preventDefault();
        e.stopPropagation();
        dragged = false;
        return;
      }
      const card = e.target.closest(".card");
      if (!card || !rail.contains(card)) return;
      if (card.classList.contains("is-focus")) return;
      e.preventDefault();
      centerCard(card);
    }, true);

    let wheelAcc = 0;
    let wheelLock = false;
    let wheelReset = 0;
    addEventListener("wheel", (e) => {
      if (!overCard(e)) return;
      let dx = e.deltaX + e.deltaY;
      if (e.deltaMode === 1) dx *= 16;
      else if (e.deltaMode === 2) dx *= Math.max(1, rail.clientWidth);
      if (!dx) return;
      e.preventDefault();
      if (wheelLock) return;
      wheelAcc += dx;
      clearTimeout(wheelReset);
      wheelReset = setTimeout(() => { wheelAcc = 0; }, 180);
      if (Math.abs(wheelAcc) < 40) return;
      const dir = wheelAcc > 0 ? 1 : -1;
      wheelAcc = 0;
      wheelLock = true;
      step(dir);
      setTimeout(() => { wheelLock = false; }, 380);
    }, { passive: false });

    addEventListener("keydown", (e) => {
      if (!stackInPlay()) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      }
    });

    paint();
    if (cards[0]) centerCard(cards[0], true);
    requestAnimationFrame(paint);
  })();

  /* ---------- telemetry sensor wheel ---------- */
  (function initTelemetryWheel() {
    const wheel = $("#telemetryWheel");
    const list = $("#telemetryWheelList");
    if (!wheel || !list) return;

    const COPIES = 3;
    const compactMq = window.matchMedia("(max-width: 860px), (max-height: 560px)");
    if (!list.dataset.looped) {
      const seeds = $$(":scope > .telemetry-wheel-item", list);
      if (!seeds.length) return;
      list.innerHTML = seeds.map((el) => el.outerHTML).join("").repeat(COPIES);
      list.dataset.looped = "1";
    }

    const items = $$(".telemetry-wheel-item", list);
    const n = items.length;
    const cycle = n / COPIES;
    const pos = new Float64Array(n);
    items.forEach((el, i) => {
      el.id = `tw-${i}`;
      el.tabIndex = -1;
      el.draggable = false;
    });

    let axis = "y";
    let view = 0;
    let itemSize = 0;
    let lastCross = 0;
    let current = "cpu";
    let laidOut = false;
    let moving = false;
    let dragging = false;
    let paneLock = null;
    let raf = 0;
    let wheelLock = false;

    function isX() {
      return compactMq.matches;
    }
    function applyAxis() {
      axis = isX() ? "x" : "y";
      wheel.classList.toggle("is-x", axis === "x");
      document.documentElement.classList.toggle("telemetry-compact", axis === "x");
      wheel.setAttribute("aria-orientation", axis === "x" ? "horizontal" : "vertical");
    }
    function pointer(e) {
      return axis === "x" ? e.clientX : e.clientY;
    }
    function center() {
      return (view - itemSize) / 2;
    }

    function wrapItem(value) {
      const span = itemSize * n;
      if (span <= 0) return value;
      return ((value + itemSize) % span + span) % span - itemSize;
    }

    function wrapAll() {
      if (!itemSize || !n) return;
      for (let i = 0; i < n; i++) pos[i] = wrapItem(pos[i]);
    }

    function shift(delta) {
      if (!itemSize || !n) return;
      for (let i = 0; i < n; i++) pos[i] = wrapItem(pos[i] - delta);
      paint();
    }

    function centerIndex() {
      const lo = view / 2 - itemSize;
      const hi = view / 2;
      for (let i = 0; i < n; i++) {
        if (pos[i] >= lo && pos[i] < hi) return i;
      }
      const target = center();
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < n; i++) {
        const d = Math.abs(pos[i] - target);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    }

    function setPane(channel) {
      if (!channel) return;
      current = channel;
      $$(".telemetry-panes .metric").forEach((pane) => {
        const on = pane.dataset.channel === channel;
        pane.classList.toggle("is-active", on);
        pane.toggleAttribute("inert", !on);
      });
    }

    function paint() {
      if (!itemSize || !view) return;
      const idx = centerIndex();
      const visible = Math.max(1, Math.ceil(view / itemSize));
      const held = wheel.classList.contains("is-drag");
      items.forEach((el, i) => {
        const value = pos[i];
        const offscreen = value < -itemSize || value > view;
        const dist = Math.abs((value - pos[idx]) / itemSize);
        const fade = Math.min(1, Math.pow((dist / visible) * 2, 0.5));
        const tilt = reduced || axis === "x" ? 0 : Math.min(36, (dist / visible) * 48);
        const nudge = reduced || axis === "x" ? 0 : (1 - Math.min(1, (dist / visible) * 2)) * itemSize * 0.12;
        el.style.setProperty("--x", `${value.toFixed(2)}px`);
        el.style.setProperty("--y", `${value.toFixed(2)}px`);
        el.style.setProperty("--fade", fade.toFixed(3));
        el.style.setProperty("--tilt", `${tilt.toFixed(2)}deg`);
        el.style.setProperty("--nudge", `${nudge.toFixed(2)}px`);
        el.style.transition = offscreen || held || moving ? "none" : "";
        const on = i === idx;
        el.classList.toggle("is-on", on);
        el.setAttribute("aria-selected", on ? "true" : "false");
        if (on) wheel.setAttribute("aria-activedescendant", el.id);
      });
      const channel = items[idx] && items[idx].dataset.channel;
      if (channel && !paneLock) setPane(channel);
    }

    function stopTween() {
      moving = false;
      cancelAnimationFrame(raf);
    }

    function goToIndex(idx, instant = false) {
      if (idx < 0 || idx >= n || !itemSize) return;
      wrapAll();
      const channel = items[idx].dataset.channel;
      const delta = pos[idx] - center();
      paneLock = channel || null;
      stopTween();
      if (channel) setPane(channel);
      if (instant || reduced || Math.abs(delta) < 0.5) {
        shift(delta);
        paneLock = null;
        paint();
        return;
      }
      const start = Float64Array.from(pos);
      const t0 = performance.now();
      const dur = 320;
      moving = true;
      const tick = (now) => {
        if (!moving) return;
        const t = Math.min(1, (now - t0) / dur);
        const e = 1 - (1 - t) ** 3;
        for (let i = 0; i < n; i++) pos[i] = wrapItem(start[i] - delta * e);
        paint();
        if (t < 1) {
          raf = requestAnimationFrame(tick);
          return;
        }
        moving = false;
        paneLock = null;
        paint();
      };
      raf = requestAnimationFrame(tick);
    }

    function step(dir) {
      wrapAll();
      const target = center() + dir * itemSize;
      let best = (centerIndex() + dir + n) % n;
      let bestD = Math.abs(pos[best] - target);
      for (let i = 0; i < n; i++) {
        const d = Math.abs(pos[i] - target);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      goToIndex(best);
    }

    function layout() {
      if (moving || dragging) return;
      const prevAxis = axis;
      applyAxis();
      const kept = laidOut
        ? ((items[centerIndex()] && items[centerIndex()].dataset.channel) || current)
        : "cpu";
      const nextView = axis === "x" ? wheel.clientWidth : wheel.clientHeight;
      const nextCross = axis === "x" ? wheel.clientHeight : wheel.clientWidth;
      const seed = items[0];
      const nextItem = seed ? (axis === "x" ? seed.offsetWidth : seed.offsetHeight) : 0;
      if (nextView < 8 || nextItem < 8) return;
      if (
        laidOut &&
        prevAxis === axis &&
        nextView === view &&
        nextCross === lastCross &&
        nextItem === itemSize
      ) return;
      view = nextView;
      lastCross = nextCross;
      itemSize = nextItem;
      const target = center();
      let origin = items.findIndex((el, i) => el.dataset.channel === kept && i >= cycle && i < cycle * 2);
      if (origin < 0) origin = items.findIndex((el) => el.dataset.channel === kept);
      if (origin < 0) origin = cycle;
      for (let i = 0; i < n; i++) pos[i] = target + (i - origin) * itemSize;
      wrapAll();
      paint();
      laidOut = true;
      wheel.classList.add("is-ready");
    }

    wheel.addEventListener("wheel", (e) => {
      e.preventDefault();
      e.stopPropagation();
      let delta = axis === "x" && Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (e.deltaMode === 1) delta *= 16;
      else if (e.deltaMode === 2) delta *= Math.max(1, itemSize);
      if (!delta || wheelLock || dragging) return;
      wheelLock = true;
      step(delta > 0 ? 1 : -1);
      setTimeout(() => { wheelLock = false; }, reduced ? 0 : 340);
    }, { passive: false });

    let dragged = false;
    let lastP = 0;
    let startP = 0;
    let pointerId = 0;

    wheel.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      dragging = true;
      dragged = false;
      lastP = startP = pointer(e);
      pointerId = e.pointerId;
      paneLock = null;
      stopTween();
    });
    wheel.addEventListener("pointermove", (e) => {
      if (!dragging || e.pointerId !== pointerId) return;
      const p = pointer(e);
      if (!dragged && Math.abs(p - startP) > 5) {
        dragged = true;
        wheel.classList.add("is-drag");
        try { wheel.setPointerCapture(pointerId); } catch {}
      }
      if (!dragged) return;
      e.preventDefault();
      shift(-(p - lastP));
      lastP = p;
    });
    const endDrag = (e) => {
      if (!dragging || (e && e.pointerId !== pointerId)) return;
      dragging = false;
      wheel.classList.remove("is-drag");
      paint();
      if (dragged) goToIndex(centerIndex());
    };
    wheel.addEventListener("pointerup", endDrag);
    wheel.addEventListener("pointercancel", endDrag);

    function indexAtPointer(client) {
      const box = wheel.getBoundingClientRect();
      const along = client - (axis === "x" ? box.left : box.top);
      let best = centerIndex();
      let bestD = Infinity;
      for (let i = 0; i < n; i++) {
        if (pos[i] < -itemSize * 0.5 || pos[i] > view) continue;
        const d = Math.abs(pos[i] + itemSize / 2 - along);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    }

    wheel.addEventListener("click", (e) => {
      if (dragged) {
        e.preventDefault();
        e.stopPropagation();
        dragged = false;
        return;
      }
      goToIndex(indexAtPointer(pointer(e)));
    });

    wheel.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "PageDown" || e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      } else if (e.key === "ArrowUp" || e.key === "PageUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      }
    });

    const onCompact = () => {
      laidOut = false;
      layout();
    };
    if (typeof compactMq.addEventListener === "function") compactMq.addEventListener("change", onCompact);
    else if (typeof compactMq.addListener === "function") compactMq.addListener(onCompact);
    addEventListener("resize", layout);
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(layout).observe(wheel);
    }
    applyAxis();
    layout();
    requestAnimationFrame(layout);
  })();

  /* ---------- node panel (hero inspect) ---------- */
  const panelTitle = $("#panelTitle");
  const panelCopy = $("#panelCopy");
  const panelFacts = $("#panelFacts");
  const inspect = $("#orbitInspect");
  function renderFacts(n) {
    if (!panelFacts) return;
    panelFacts.innerHTML = n.facts.map(([k, v]) => `<li><span>${k}</span><b>${v}</b></li>`).join("");
  }
  function selectNode(key, { orbit = false } = {}) {
    const n = NODES[key];
    if (!n) return;
    selectedNode = key;
    $$("[data-orbit-node]").forEach((el) => el.classList.toggle("is-on", el.dataset.orbitNode === key));
    if (panelTitle) panelTitle.textContent = n.title;
    if (panelCopy) panelCopy.textContent = n.copy;
    renderFacts(n);
    if (inspect) {
      inspect.classList.add("is-open");
      inspect.setAttribute("aria-hidden", "false");
    }
    if (orbit && window.nvcOrbit) window.nvcOrbit.focus(key);
  }
  $$("[data-orbit-node]").forEach((el) => {
    el.addEventListener("click", () => selectNode(el.dataset.orbitNode, { orbit: true }));
  });
  document.addEventListener("nvc:focus-node", (e) => {
    if (e.detail && e.detail.id) selectNode(e.detail.id);
  });

  function fmtUptime(sec) {
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    return `${d}d ${pad(h)}h`;
  }
  function setLed(el, state) {
    if (!el) return;
    el.classList.remove("live", "wait", "down");
    el.classList.add(state === "live" ? "live" : state === "down" ? "down" : "wait");
  }
  const isMetric = (value) => typeof value === "number" && Number.isFinite(value);
  function setText(id, value) {
    const el = $(`#${id}`);
    if (el) el.textContent = value;
  }
  function fmtRam(mb) {
    if (!isMetric(mb) || mb <= 0) return "—";
    const gb = mb / 1024;
    return `${gb < 10 ? gb.toFixed(2) : gb.toFixed(1)} GB`;
  }
  function fmtDisk(gb) {
    if (!isMetric(gb) || gb < 0) return "—";
    return `${gb < 10 ? gb.toFixed(2) : gb.toFixed(1)} GB`;
  }
  function setPercentMetric(name, value) {
    const valid = isMetric(value);
    const bounded = valid ? clamp(value, 0, 100) : 0;
    setText(`${name}Value`, valid ? bounded.toFixed(1) : "--.-");
    const fill = $(`#${name}Fill`);
    if (fill) fill.style.width = `${bounded}%`;
    const meter = $(`#${name}Meter`);
    if (meter) {
      if (valid) {
        meter.setAttribute("aria-valuenow", bounded.toFixed(1));
        meter.removeAttribute("aria-valuetext");
      } else {
        meter.removeAttribute("aria-valuenow");
        meter.setAttribute("aria-valuetext", "Unavailable");
      }
    }
  }
  const TRACE_W = 240;
  const TRACE_H = 72;
  const TRACE_PAD = 3;
  const SEA_POINTS = 48;
  const seas = {};

  function densifyTrace(pts, count) {
    if (!pts.length) return [];
    if (pts.length === 1) {
      return Array.from({ length: count }, () => ({ x: pts[0].x, y: pts[0].y }));
    }
    const out = [];
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const f = t * (pts.length - 1);
      const j = Math.min(pts.length - 2, Math.floor(f));
      const u = f - j;
      out.push({
        x: pts[j].x + (pts[j + 1].x - pts[j].x) * u,
        y: pts[j].y + (pts[j + 1].y - pts[j].y) * u,
      });
    }
    return out;
  }
  function traceLinePath(points) {
    if (!points.length) return "";
    let d = `M${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
    for (let i = 1; i < points.length; i++) {
      const p = points[i];
      const nxt = points[i + 1];
      if (!nxt) {
        d += ` L${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
        break;
      }
      d += ` Q${p.x.toFixed(2)} ${p.y.toFixed(2)} ${((p.x + nxt.x) / 2).toFixed(2)} ${((p.y + nxt.y) / 2).toFixed(2)}`;
    }
    return d;
  }
  function traceAreaPath(points) {
    if (!points.length) return "";
    const yb = TRACE_H - TRACE_PAD;
    const last = points[points.length - 1];
    const first = points[0];
    return `${traceLinePath(points)} L${last.x.toFixed(2)} ${yb.toFixed(2)} L${first.x.toFixed(2)} ${yb.toFixed(2)} Z`;
  }
  function paintTrace(name, points) {
    const line = $(`#${name}Trace`);
    const area = $(`#${name}Area`);
    if (line) line.setAttribute("d", traceLinePath(points));
    if (area) area.setAttribute("d", points.length ? traceAreaPath(points) : "");
  }
  function getSea(name) {
    if (seas[name]) return seas[name];
    const line = $(`#${name}Trace`);
    const box = line && line.closest(".trace-box");
    const sea = {
      name,
      box,
      rest: [],
      pts: [],
      hover: false,
      mx: 0,
      my: 0,
      dx: 0,
      dy: 0,
    };
    seas[name] = sea;
    if (box && !reduced) {
      box.dataset.sea = "1";
      box.addEventListener("pointerenter", () => {
        sea.hover = true;
        box.classList.add("is-wet");
        kickSea();
      });
      box.addEventListener("pointerleave", () => {
        sea.hover = false;
        box.classList.remove("is-wet");
        sea.dx = 0;
        sea.dy = 0;
        sea._lx = null;
        sea._ly = null;
        kickSea();
      });
      box.addEventListener("pointermove", (e) => {
        const r = box.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const mx = ((e.clientX - r.left) / r.width) * TRACE_W;
        const my = ((e.clientY - r.top) / r.height) * TRACE_H;
        if (sea._lx != null) {
          sea.dx += mx - sea._lx;
          sea.dy += my - sea._ly;
        }
        sea._lx = mx;
        sea._ly = my;
        sea.mx = mx;
        sea.my = my;
        sea.hover = true;
        kickSea();
      }, { passive: true });
    }
    return sea;
  }
  function setSeaRest(name, rest) {
    const sea = getSea(name);
    const dense = densifyTrace(rest, SEA_POINTS);
    sea.rest = dense;
    if (!sea.pts.length || sea.pts.length !== dense.length) {
      sea.pts = dense.map((p, i) => ({
        x: p.x,
        y: p.y,
        ox: p.x,
        oy: p.y,
        vx: 0,
        vy: 0,
        fixed: i === 0 || i === dense.length - 1,
      }));
    } else {
      sea.pts.forEach((pt, i) => {
        pt.ox = dense[i].x;
        pt.oy = dense[i].y;
        if (!sea.hover) {
          pt.x = dense[i].x;
          pt.y = dense[i].y;
          pt.vx = 0;
          pt.vy = 0;
        }
      });
    }
    paintTrace(name, sea.hover ? sea.pts : dense);
  }
  let seaRaf = 0;
  function kickSea() {
    if (reduced || seaRaf) return;
    const step = () => {
      let energy = 0;
      let hovering = false;
      Object.keys(seas).forEach((name) => {
        const sea = seas[name];
        if (!sea.pts.length) return;
        hovering = hovering || sea.hover;
        const radius = 44;
        const mass = 12;
        const damp = 0.92;
        const kX = 0.5;
        const kY = 0.28;
        const amp = 3.2;
        sea.dx = clamp(sea.dx, -5, 5);
        sea.dy = clamp(sea.dy, -5, 5);
        sea.pts.forEach((pt, i) => {
          if (pt.fixed) {
            pt.x = pt.ox;
            pt.y = pt.oy;
            return;
          }
          let fx = (pt.ox - pt.x) * kX;
          let fy = (pt.oy - pt.y) * kY;
          const prev = sea.pts[i - 1];
          const next = sea.pts[i + 1];
          if (prev) {
            fx += (prev.x - pt.x) * 0.14;
            fy += (prev.y - pt.y) * 0.14;
          }
          if (next) {
            fx += (next.x - pt.x) * 0.14;
            fy += (next.y - pt.y) * 0.14;
          }
          if (sea.hover) {
            const dist = Math.hypot(pt.x - sea.mx, pt.y - sea.my);
            if (dist < radius) {
              const falloff = 1 - dist / radius;
              fx += sea.dx * falloff * 0.2;
              fy += sea.dy * falloff * 0.2;
            }
            const along = Math.abs(pt.x - sea.mx);
            if (along < radius) {
              const lobe = Math.cos((along / radius) * Math.PI * 0.5);
              const side = clamp(sea.my - pt.oy, -14, 14);
              fy += lobe * lobe * side * 0.04;
            }
          }
          pt.vx = damp * pt.vx + fx / mass;
          pt.vy = damp * pt.vy + fy / mass;
          pt.x += pt.vx;
          pt.y += pt.vy;
          pt.x = clamp(pt.x, pt.ox - 2.4, pt.ox + 2.4);
          pt.y = clamp(pt.y, pt.oy - amp, pt.oy + amp);
          pt.y = clamp(pt.y, TRACE_PAD, TRACE_H - TRACE_PAD);
          energy += pt.vx * pt.vx + pt.vy * pt.vy;
        });
        sea.dx = 0;
        sea.dy = 0;
        paintTrace(name, sea.pts);
      });
      if (hovering || energy > 0.0008) seaRaf = requestAnimationFrame(step);
      else seaRaf = 0;
    };
    seaRaf = requestAnimationFrame(step);
  }

  function pushTrace(name, value, min = 0, max = 100) {
    if (!isMetric(value)) return;
    const values = telemetryHistory[name];
    if (!values) return;
    values.push(value);
    if (values.length > HISTORY_POINTS) values.shift();
    const samples = values.length === 1 ? [values[0], values[0]] : values;
    const yOf = (sample) => {
      const ratio = (clamp(sample, min, max) - min) / (max - min || 1);
      return TRACE_H - TRACE_PAD - ratio * (TRACE_H - TRACE_PAD * 2);
    };
    const span = TRACE_W - TRACE_PAD * 2;
    const step = span / (HISTORY_POINTS - 1);
    const firstX = TRACE_W - TRACE_PAD - step * (samples.length - 1);
    const rest = [];
    for (let i = 0; i < SEA_POINTS; i++) {
      const x = TRACE_PAD + (i / (SEA_POINTS - 1)) * span;
      let y;
      if (samples.length === 1 || x <= firstX) {
        y = yOf(samples[0]);
      } else {
        const t = (x - firstX) / (TRACE_W - TRACE_PAD - firstX || 1);
        const f = t * (samples.length - 1);
        const j = Math.min(samples.length - 2, Math.floor(f));
        const u = f - j;
        y = yOf(samples[j]) * (1 - u) + yOf(samples[j + 1]) * u;
      }
      rest.push({ x, y });
    }
    setSeaRest(name, rest);
  }
  function setTelemetryConnection(state) {
    const consoleEl = $("#telemetryConsole");
    if (consoleEl) {
      consoleEl.classList.remove("is-live", "is-stale");
      if (state === "live") consoleEl.classList.add("is-live");
      if (state === "stale" || state === "offline") consoleEl.classList.add("is-stale");
    }
    const led = $("#telemetryLed");
    if (state === "live") {
      setLed(led, "live");
      setText("telemetryState", "LIVE · 1M REFRESH");
    } else if (state === "stale") {
      setLed(led, "wait");
      setText("telemetryState", "SIGNAL STALE · RETRYING");
    } else {
      setLed(led, "down");
      setText("telemetryState", "CORE TELEMETRY OFFLINE");
    }
  }
  function applyTelemetry(data, rtt) {
    const core = data.core || {};
    const cpu = core.cpu || {};
    const mem = core.mem || {};
    const disk = core.disk || {};
    const gpu = core.gpu || {};
    const thermal = core.temperature || {};
    const load = Array.isArray(core.load) ? core.load : [];

    setTelemetryConnection("live");
    lastTelemetryTs = isMetric(data.ts) ? data.ts * 1000 : Date.now();
    const sampleTime = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Los_Angeles",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(lastTelemetryTs));
    setText("telemetrySample", `${sampleTime} LAX`);

    setPercentMetric("cpu", cpu.usage_pct);
    setPercentMetric("mem", mem.used_pct);
    setPercentMetric("disk", disk.used_pct);
    pushTrace("cpu", cpu.usage_pct);
    pushTrace("mem", mem.used_pct);
    pushTrace("disk", disk.used_pct);

    setText("cpuCores", isMetric(cpu.logical_cores) ? cpu.logical_cores : "—");
    setText("cpuLoad", isMetric(load[0]) ? Number(load[0]).toFixed(2) : "—");
    if (isMetric(cpu.usage_pct)) {
      setText("cpuSignal", cpu.usage_pct >= 90 ? "CRITICAL" : cpu.usage_pct >= 70 ? "ELEVATED" : "NOMINAL");
    } else {
      setText("cpuSignal", "UNAVAILABLE");
    }

    setText("memUsed", fmtRam(mem.used_mb));
    setText("memTotal", fmtRam(mem.total_mb));
    setText("diskUsed", fmtDisk(disk.used_gb));
    setText("diskTotal", fmtDisk(disk.total_gb));

    const gpuCard = $(".metric-gpu");
    if (gpu.available) {
      if (gpuCard) gpuCard.classList.remove("is-unavailable");
      setPercentMetric("gpu", gpu.usage_pct);
      setText("gpuUnit", "%");
      pushTrace("gpu", gpu.usage_pct);
      if (isMetric(gpu.usage_pct)) {
        setText("gpuSignal", gpu.usage_pct >= 90 ? "CRITICAL" : gpu.usage_pct >= 70 ? "ELEVATED" : "NOMINAL");
      } else {
        setText("gpuSignal", "DEVICE");
      }
      setText("gpuUsed", fmtRam(gpu.mem_used_mb));
      setText("gpuTotal", fmtRam(gpu.mem_total_mb));
      const count = isMetric(gpu.count) ? gpu.count : 1;
      const name = gpu.name || "GPU";
      setText("gpuName", count > 1 ? `${name} · ×${count}` : name);
      const bits = [];
      if (isMetric(gpu.mem_used_pct)) bits.push(`VRAM ${gpu.mem_used_pct}%`);
      if (isMetric(gpu.celsius)) bits.push(`die ${gpu.celsius}°C`);
      bits.push(count === 1 ? "driver reading." : `${count} devices averaged.`);
      setText("gpuNote", bits.join(" · "));
    } else {
      if (gpuCard) gpuCard.classList.add("is-unavailable");
      setPercentMetric("gpu", null);
      setText("gpuUnit", "");
      setText("gpuValue", "N/A");
      setText("gpuSignal", "NOT EXPOSED");
      setText("gpuUsed", "—");
      setText("gpuTotal", "—");
      setText("gpuName", "NO DISCRETE GPU / NO DRIVER");
      setText("gpuNote", "The host exposes no GPU metrics; the probe does not fabricate utilization.");
    }

    const tempCard = $(".metric-temperature");
    if (thermal.available && isMetric(thermal.celsius)) {
      if (tempCard) tempCard.classList.remove("is-unavailable");
      setText("tempValue", Number(thermal.celsius).toFixed(1));
      setText("tempUnit", "°C");
      setText("tempSignal", thermal.celsius >= 85 ? "CRITICAL" : thermal.celsius >= 70 ? "ELEVATED" : "NOMINAL");
      setText("tempSensor", thermal.label || "KERNEL THERMAL SENSOR");
      const sensorCount = Array.isArray(thermal.sensors) ? thermal.sensors.length : 1;
      setText("tempNote", `${sensorCount} kernel sensor${sensorCount === 1 ? "" : "s"} exposed · direct sysfs reading.`);
      pushTrace("temp", thermal.celsius, 20, 100);
    } else {
      if (tempCard) tempCard.classList.add("is-unavailable");
      setText("tempValue", "N/A");
      setText("tempUnit", "");
      setText("tempSignal", "NOT EXPOSED");
      setText("tempSensor", "VIRTUAL HOST / NO SENSOR");
      setText("tempNote", "The hypervisor exposes no thermal sensor; the probe does not fabricate a temperature.");
    }

    setText("telemetryProbe", rtt != null ? `${rtt}ms` : "—");
  }
  function pillFor(svc) {
    if (!svc) return PILL.probe;
    if (svc.status === "live") {
      if (svc.scope === "private") return PILL.private;
      if (svc.scope === "loopback") return PILL.loopback;
      if (svc.scope === "planned") return PILL.standby;
      return PILL.live;
    }
    if (svc.status === "standby") return PILL.standby;
    return PILL.down;
  }
  function paintOrbit(data) {
    const ok = !!(data && data.ok);
    $$("[data-orbit-node]").forEach((btn) => {
      const id = btn.dataset.orbitNode;
      setLed(btn.querySelector(".led"), id === "core" ? (ok ? "live" : "down") : "wait");
    });
    window.nvcLastStatus = data;
    document.dispatchEvent(new CustomEvent("nvc:status", { detail: { data } }));
    if (window.nvcOrbit) window.nvcOrbit.setCoreLive(ok);
  }
  function applyStatus(data, rtt) {
    const meshLed = $("#meshLed");
    const meshSys = $("#meshSys");
    const meshCount = $("#meshCount");
    const probeMeta = $("#probeMeta");
    const statCore = $("#statCore");
    const statPath = $("#statPath");
    const coreLed = $("#coreLed");

    if (!data || !data.ok) {
      setLed(meshLed, "wait");
      if (meshSys) meshSys.textContent = "SYS.WAIT · MESH/4";
      if (meshCount) meshCount.textContent = "CORE UNREACHABLE";
      if (probeMeta) probeMeta.textContent = "PROBE LOST";
      if (statCore) {
        statCore.textContent = "Los Angeles · UNREACHABLE";
        statCore.classList.remove("cyan", "amber");
        statCore.classList.add("down");
      }
      if (statPath) statPath.textContent = "YOU → CORE · —";
      if ($("#statMesh")) $("#statMesh").textContent = "4 NODES";
      setLed(coreLed, "wait");
      setTelemetryConnection("offline");
      paintOrbit(data);
      $$("[data-probe]").forEach((card) => {
        const pill = card.querySelector(".pill");
        if (pill && !card.classList.contains("planned")) {
          const p = PILL.probe;
          pill.className = p.cls;
          pill.textContent = p.text;
        }
      });
      return;
    }

    lastStatus = data;
    lastRtt = rtt;
    if (data.core && data.core.uptime_sec != null) hostUptimeSec = data.core.uptime_sec;
    applyTelemetry(data, rtt);

    const pub = data.summary || {};
    const liveN = pub.public_live ?? 0;
    const totN = pub.public_total ?? 0;
    setLed(meshLed, "live");
    if (meshSys) meshSys.textContent = "SYS.OK · MESH/4";
    if (meshCount) meshCount.textContent = `1 LIVE · 3 STANDBY · ${liveN}/${totN} PUB`;
    if ($("#statMesh")) $("#statMesh").textContent = "1 LIVE · 3 STANDBY";
    if (probeMeta) probeMeta.textContent = `PROBE ${data.probe_ms != null ? data.probe_ms + "ms" : "OK"}`;
    if (statCore) {
      statCore.textContent = "Los Angeles · LIVE";
      statCore.classList.remove("down", "amber");
      statCore.classList.add("cyan");
    }
    if (statPath) {
      statPath.textContent = rtt != null ? `YOU → CORE · ${rtt}ms` : "YOU → CORE";
      statPath.classList.add("cyan");
    }
    setLed(coreLed, "live");
    paintOrbit(data);

    const load = (data.core && data.core.load) || [];
    const cpu = (data.core && data.core.cpu) || {};
    const mem = (data.core && data.core.mem) || {};
    const disk = (data.core && data.core.disk) || {};
    const gpu = (data.core && data.core.gpu) || {};
    const thermal = (data.core && data.core.temperature) || {};
    const up = data.core && data.core.uptime_sec != null ? fmtUptime(data.core.uptime_sec) : "—";
    NODES.core.facts = [
      ["ROLE", "ORIGIN"],
      ["REGION", "LAX / PDT"],
      ["STATUS", "ONLINE"],
      ["CPU", cpu.usage_pct != null ? `${cpu.usage_pct}%` : "—"],
      ["GPU", gpu.available && gpu.usage_pct != null ? `${gpu.usage_pct}%` : "N/A"],
      ["LOAD", load.length ? load.map((n) => Number(n).toFixed(2)).join(" ") : "—"],
      ["MEM", mem.used_pct != null ? `${mem.used_pct}%` : "—"],
      ["DISK", disk.used_pct != null ? `${disk.used_pct}%` : "—"],
      ["THERMAL", thermal.available && thermal.celsius != null ? `${thermal.celsius}°C` : "N/A"],
      ["UPTIME", up],
    ];
    const rttLine = rtt != null ? `time=${rtt}ms ttl=pacific` : "ttl=pacific";
    const gpuLine = gpu.available && gpu.usage_pct != null ? gpu.usage_pct + "%" : "not exposed";
    NODES.core.term = `> probe core.lax\ncpu ${cpu.usage_pct != null ? cpu.usage_pct + "%" : "—"} · gpu ${gpuLine} · load ${load[0] != null ? Number(load[0]).toFixed(2) : "—"}\nmem ${mem.used_pct != null ? mem.used_pct + "%" : "—"} · disk ${disk.used_pct != null ? disk.used_pct + "%" : "—"}\ntemp ${thermal.available && thermal.celsius != null ? thermal.celsius + "°C" : "not exposed"} · up ${up}\n> path\n${rttLine}`;
    if (selectedNode === "core") {
      renderFacts(NODES.core);
    }

    $$("[data-probe]").forEach((card) => {
      const id = card.dataset.probe;
      const svc = data.services && data.services[id];
      const pill = card.querySelector(".pill");
      if (pill) {
        const p = id === "apac" ? PILL.standby : pillFor(svc);
        pill.className = p.cls;
        pill.textContent = p.text;
      }
      const msEl = card.querySelector("[data-probe-ms]");
      if (msEl) {
        if (svc && svc.status === "live" && svc.latency_ms != null) {
          msEl.textContent = `${svc.latency_ms}ms`;
          msEl.classList.add("live");
        } else {
          msEl.textContent = "";
          msEl.classList.remove("live");
        }
      }
    });
  }

  async function pullStatus() {
    const t0 = performance.now();
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      const rtt = Math.round(performance.now() - t0);
      if (!res.ok) throw new Error("probe");
      const data = await res.json();
      applyStatus(data, rtt);
    } catch {
      if (!lastStatus) applyStatus(null, null);
      else {
        if ($("#probeMeta")) $("#probeMeta").textContent = "PROBE RETRY";
        setTelemetryConnection("stale");
      }
    }
  }
  pullStatus();
  setInterval(pullStatus, PROBE_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) pullStatus();
  });

  /* ---------- compact glass nav ---------- */
  const nav = $("#nav");
  const brandReveal = $("#brandReveal");
  const brandFixed = $("#brandRevealFixed");
  const brandStatic = $("#brandRevealStatic");
  const brandCanvas = $("#brandRevealCanvas");
  const BRAND_TEXT = "NVC.AC";
  const brandVars = brandReveal || document.documentElement;
  const brandWord = brandStatic && brandStatic.querySelector(".brand-reveal-word");

  let navCompact = 0;
  let lastNavT = performance.now();
  let scrolling = false;
  let scrollQuietAt = 0;

  function navCompactTarget() {
    if (!nav) return 0;
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    return clamp(y / 96, 0, 1);
  }
  function applyNavCompact(t) {
    if (!nav) return;
    nav.style.setProperty("--nav-compact", t.toFixed(3));
    root.classList.toggle("is-scrolled", t > 0.55);
    nav.classList.toggle("is-compact", t > 0.55);
    nav.setAttribute("data-compact", t > 0.55 ? "1" : "0");
  }
  function markScrolling() {
    scrolling = true;
    scrollQuietAt = performance.now() + 140;
    root.classList.add("is-scrolling");
  }
  function tickNav(now = performance.now()) {
    const target = navCompactTarget();
    const dt = Math.max(0, now - lastNavT);
    lastNavT = now;
    if (reduced) {
      navCompact = target;
    } else {
      const k = 1 - Math.exp(-dt / 160);
      navCompact = lerp(navCompact, target, k);
      if (Math.abs(navCompact - target) < 0.003) navCompact = target;
    }
    applyNavCompact(navCompact);
    clipBrandReveal();
    if (scrolling && now >= scrollQuietAt) {
      scrolling = false;
      root.classList.remove("is-scrolling");
    }
  }
  navCompact = navCompactTarget();
  applyNavCompact(navCompact);
  addEventListener("scroll", () => {
    markScrolling();
    tickNav();
  }, { passive: true });
  addEventListener("wheel", markScrolling, { passive: true });
  addEventListener("touchmove", markScrolling, { passive: true });

  /* ---------- footer well: clip tracks the well; the word eases in whole ---------- */
  function clipBrandReveal() {
    if (!brandReveal || !brandFixed) return;
    const well = brandReveal.getBoundingClientRect();
    const h = well.height;
    if (h < 1) {
      brandFixed.classList.remove("is-open");
      root.classList.remove("is-brand");
      return;
    }
    const clip = clamp(well.top - (innerHeight - h), 0, h);
    const progress = clamp(1 - clip / h, 0, 1);
    brandVars.style.setProperty("--brand-clip", `${clip.toFixed(2)}px`);
    brandVars.style.setProperty("--brand-reveal", progress.toFixed(4));

    const windowOpen = progress > (brandFixed.classList.contains("is-open") ? 0.008 : 0.03);
    brandFixed.classList.toggle("is-open", windowOpen);

    const shownNow = root.classList.contains("is-brand");
    const need = shownNow ? 4 : 18;
    let uncovered = progress >= 0.62;
    if (brandWord && windowOpen) {
      uncovered = brandWord.getBoundingClientRect().top >= well.top + need;
    }
    root.classList.toggle("is-brand", uncovered && progress > 0.12);
  }
  clipBrandReveal();
  addEventListener("resize", clipBrandReveal);

  /* ---------- footer brand mark + hover disturbance ---------- */
  function makeGrid(w, h, cell) {
    const columns = Math.ceil(w / cell);
    const rows = Math.ceil(h / cell);
    const n = columns * rows;
    return {
      columns,
      rows,
      cellSize: cell,
      offsetX: new Float32Array(n),
      offsetY: new Float32Array(n),
    };
  }

  function fitBrandFont(ctx, text, maxW, startPx, minPx) {
    let size = startPx;
    ctx.font = `800 ${size}px Syne, "Avenir Next", sans-serif`;
    while (size > minPx && ctx.measureText(text).width > maxW) {
      size -= 4;
      ctx.font = `800 ${size}px Syne, "Avenir Next", sans-serif`;
    }
    return size;
  }

  function paintBrandWord(ctx, w, h, color) {
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = color;
    fitBrandFont(ctx, BRAND_TEXT, w * 0.92, h * 0.72, 64);
    const tw = ctx.measureText(BRAND_TEXT).width;
    ctx.fillText(BRAND_TEXT, (w - tw) / 2, h * 0.78);
    ctx.restore();
  }

  function initBrandDisturbance() {
    if (!brandCanvas || !brandFixed || !brandStatic) return;
    const ctx = brandCanvas.getContext("2d");
    if (!ctx || reduced) return;

    const src = document.createElement("canvas");
    const srcCtx = src.getContext("2d");
    if (!srcCtx) return;

    let raf = 0;
    let cssW = 1;
    let cssH = 1;
    let dpr = 1;
    let grid = makeGrid(1, 1, 16);
    let ink = "#d8fff4";
    let lastX = 0;
    let lastY = 0;
    let armed = false;
    let running = false;
    let visible = false;

    const readInk = () => {
      const cs = getComputedStyle(brandFixed);
      ink = cs.color || "#d8fff4";
    };

    const redraw = () => {
      if (!visible) return;
      const r = brandCanvas.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return;
      readInk();
      dpr = Math.min(devicePixelRatio || 1, 2);
      cssW = Math.max(1, Math.floor(r.width * dpr));
      cssH = Math.max(1, Math.floor(r.height * dpr));
      brandCanvas.width = cssW;
      brandCanvas.height = cssH;
      src.width = cssW;
      src.height = cssH;
      const cell = Math.round(clamp(r.width / 76 * dpr, 14 * dpr, 30 * dpr));
      grid = makeGrid(cssW, cssH, cell);
      paintBrandWord(srcCtx, cssW, cssH, ink);
      ctx.drawImage(src, 0, 0);
      brandStatic.setAttribute("data-canvas-active", "true");
    };

    const kick = () => {
      if (running || !visible || reduced || scrolling) return;
      running = true;
      raf = requestAnimationFrame(tick);
    };

    const onMove = (e) => {
      if (!visible || scrolling) {
        armed = false;
        return;
      }
      const r = brandCanvas.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
        armed = false;
        return;
      }
      const x = (e.clientX - r.left) * dpr;
      const y = (e.clientY - r.top) * dpr;
      const dx = armed ? x - lastX : 0;
      const dy = armed ? y - lastY : 0;
      lastX = x;
      lastY = y;
      armed = true;
      const speed = Math.min(Math.hypot(dx, dy), 80 * dpr);
      const radius = 0.36 * Math.min(cssW, cssH);
      const c0 = clamp(Math.floor((x - radius) / grid.cellSize), 0, grid.columns - 1);
      const c1 = clamp(Math.ceil((x + radius) / grid.cellSize), 0, grid.columns - 1);
      const r0 = clamp(Math.floor((y - radius) / grid.cellSize), 0, grid.rows - 1);
      const r1 = clamp(Math.ceil((y + radius) / grid.cellSize), 0, grid.rows - 1);
      const cap = 0.95 * grid.cellSize;
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const cx = col * grid.cellSize + grid.cellSize / 2;
          const cy = row * grid.cellSize + grid.cellSize / 2;
          const dist = Math.hypot(x - cx, y - cy);
          if (dist > radius) continue;
          const i = row * grid.columns + col;
          const falloff = (1 - dist / radius) ** 2;
          const jitter = (Math.random() - 0.5) * speed * 0.22;
          grid.offsetX[i] = clamp(grid.offsetX[i] + (0.9 * dx + jitter) * falloff, -cap, cap);
          grid.offsetY[i] = clamp(grid.offsetY[i] + (0.75 * dy - jitter) * falloff, -cap, cap);
        }
      }
      kick();
    };

    const tick = () => {
      ctx.clearRect(0, 0, cssW, cssH);
      let energy = 0;
      for (let row = 0; row < grid.rows; row++) {
        for (let col = 0; col < grid.columns; col++) {
          const i = row * grid.columns + col;
          const sx = col * grid.cellSize;
          const sy = row * grid.cellSize;
          const sw = Math.min(grid.cellSize, cssW - sx);
          const sh = Math.min(grid.cellSize, cssH - sy);
          grid.offsetX[i] *= 0.88;
          grid.offsetY[i] *= 0.88;
          if (Math.abs(grid.offsetX[i]) < 0.04) grid.offsetX[i] = 0;
          if (Math.abs(grid.offsetY[i]) < 0.04) grid.offsetY[i] = 0;
          energy += Math.abs(grid.offsetX[i]) + Math.abs(grid.offsetY[i]);
          ctx.drawImage(src, sx, sy, sw, sh, sx + grid.offsetX[i], sy + grid.offsetY[i], sw, sh);
        }
      }
      if (energy === 0) {
        running = false;
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    addEventListener("resize", redraw);
    addEventListener("pointermove", onMove, { passive: true });

    const brandIo = new IntersectionObserver((entries) => {
      visible = entries[0] && entries[0].isIntersecting;
      if (visible) {
        redraw();
        kick();
      } else {
        running = false;
        cancelAnimationFrame(raf);
      }
    });
    brandIo.observe(brandReveal);
  }

  initBrandDisturbance();

  /* ---------- raf ---------- */
  function frame(now) {
    tickNav(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* ---------- reveal ---------- */
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) {
        en.target.classList.add("reveal");
        io.unobserve(en.target);
      }
    });
  }, { threshold: 0.12 });
  $$(".sec-head, .telemetry-console, .card, .proj, .op-card").forEach((el, i) => {
    el.style.animationDelay = `${(i % 6) * 0.06}s`;
    io.observe(el);
  });
})();
