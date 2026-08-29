(() => {
  const stack = document.getElementById("asciiStack");
  const farEl = document.getElementById("asciiFar");
  const nearEl = document.getElementById("asciiNear");
  if (!stack || !farEl || !nearEl) return;

  const farCtx = farEl.getContext("2d", { alpha: true, desynchronized: true });
  const nearCtx = nearEl.getContext("2d", { alpha: true, desynchronized: true });
  if (!farCtx || !nearCtx) return;

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarse = matchMedia("(pointer: coarse)").matches;
  const foot = document.querySelector(".site-foot");

  const COL = coarse ? 8 : 7;
  const ROW = coarse ? 18 : 16;
  const PERIOD = 160;

  const TERMS = {
    net: [
      "SNI", "TLS", "TCP", "UDP", "QUIC", "HTTP", "HTTP2", "HTTP3", "ALPN",
      "NGINX", "STREAM", "TUNNEL", "INGRESS", "EGRESS", "REVERSE",
      "SOCKET", "BIND", "LISTEN", "ACCEPT", "EPOLL", "KQUEUE",
      "MTU", "MSS", "CIDR", "DNS", "AAAA", "PTR", "CNAME", "NS",
      "NAT", "ACL", "WAF", "CDN", "POP", "ANYCAST", "BGP",
      "VXLAN", "GRE", "IPSEC", "WIREGUARD", "XDP", "EBPF",
      "SYN", "ACK", "FIN", "RST", "KEEPALIVE", "NAGLE",
      "TSO", "GSO", "GRO", "LRO", "RPS", "XPS", "JUMBO",
      "OCSP", "ACME", "X509", "HMAC", "AES-GCM", "KTLS",
    ],
    ops: [
      "PROBE", "TELEMETRY", "LATENCY", "RTT", "TTL", "PATH", "HOP",
      "CPU", "MEM", "DISK", "LOAD", "THERMAL", "UPTIME", "IOPS",
      "KERNEL", "HOST", "SENSOR", "HEALTHZ", "SAMPLE", "SIGNAL",
      "SYSCTL", "CGROUP", "NAMESPACE", "PID", "RSS", "IRQ",
      "OOM", "NICE", "SWAP", "NVME", "EXT4", "JOURNAL", "SYSTEMD",
      "CONNTRACK", "NFTABLES", "IPTABLES", "SYSLOG", "METRIC",
      "P99", "P95", "SLO", "SLA", "QPS", "RPS", "BPS",
    ],
    mesh: [
      "MESH", "CORE", "EDGE", "ORIGIN", "NODE", "APAC", "POP",
      "RELAY", "HANDOFF", "CACHE", "STANDBY", "LIVE", "FAILOVER",
      "LOOPBACK", "PROXY", "DOCKER", "UBUNTU", "NVC.AC", "CLOUDFLARE",
      "LAX", "TYO", "SEL", "HKG", "UTC", "PDT", "PDT-7",
      "API", "UMAMI", "MAIL", "VPN", "SMTP", "IMAP", "SNI",
      "NEW-API", "DOCS-AGENT", "CLI-PROXY", "STALWART", "INGRESS",
    ],
  };

  const PORTS = ["22", "25", "80", "443", "587", "993", "2053", "2096", "3000", "4173", "8080", "8443"];
  const UNITS = ["ms", "us", "%", "MB", "GB", "KiB", "dB"];

  const LAYERS = coarse
    ? [
        { plane: "far", seed: 0x51a3, size: 12, speed: 95, laneMod: 2, lane: 0, kinds: ["net"], palette: "far" },
        { plane: "near", seed: 0x7c2e, size: 12, speed: 180, laneMod: 2, lane: 1, kinds: ["ops", "mesh"], palette: "near" },
      ]
    : [
        { plane: "far", seed: 0x51a3, size: 12, speed: 90, laneMod: 3, lane: 0, kinds: ["net"], palette: "far" },
        { plane: "near", seed: 0x2b19, size: 12, speed: 155, laneMod: 3, lane: 1, kinds: ["ops"], palette: "mid" },
        { plane: "near", seed: 0x7c2e, size: 12, speed: 240, laneMod: 3, lane: 2, kinds: ["mesh"], palette: "near" },
      ];

  const PALETTE = {
    far: [
      [118, 148, 138, 0.46],
      [88, 118, 108, 0.34],
    ],
    mid: [
      [138, 163, 151, 0.52],
      [93, 210, 176, 0.36],
      [126, 182, 255, 0.24],
    ],
    near: [
      [93, 255, 200, 0.42],
      [182, 255, 232, 0.32],
      [138, 163, 151, 0.28],
    ],
  };

  function mulberry32(seed) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rgba(c) {
    return `rgba(${c[0]},${c[1]},${c[2]},${c[3]})`;
  }

  function pick(rand, list) {
    return list[(rand() * list.length) | 0];
  }

  function num(rand, min, max, digits) {
    const v = min + rand() * (max - min);
    return digits == null ? String(v | 0) : v.toFixed(digits);
  }

  function hexByte(rand) {
    return ((rand() * 256) | 0).toString(16).padStart(2, "0");
  }

  function rotate(tape, n) {
    const len = tape.length;
    const k = ((n % len) + len) % len;
    return k ? tape.slice(k).concat(tape.slice(0, k)) : tape;
  }

  function token(kind, rand) {
    const terms = TERMS[kind];
    const a = pick(rand, terms);
    const b = pick(rand, terms);
    const p = pick(rand, PORTS);
    const u = pick(rand, UNITS);
    const roll = rand();

    if (roll < 0.28) return a;
    if (roll < 0.38) return `${a}=${num(rand, 1, 99)}${u}`;
    if (roll < 0.46) return `${a}:${num(rand, 0, 99, 1)}`;
    if (roll < 0.52) return `${p}/${pick(rand, ["tcp", "udp", "sni", "tls", "quic"])}`;
    if (roll < 0.58) return `${a}->${b}`;
    if (roll < 0.63) return `${a}|${b}`;
    if (roll < 0.68) return `[${a}]`;
    if (roll < 0.72) return `{${a}}`;
    if (roll < 0.76) return `(${a}+${num(rand, 1, 16)})`;
    if (roll < 0.80) return `${a}${rand() < 0.5 ? "+" : "-"}${num(rand, 1, 64)}`;
    if (roll < 0.84) return `${a}*${num(rand, 2, 8)}`;
    if (roll < 0.87) return `${a}${rand() < 0.5 ? ">" : "<"}${num(rand, 1, 100, 2)}`;
    if (roll < 0.90) return `0x${hexByte(rand)}${hexByte(rand)}`;
    if (roll < 0.93) return pick(rand, ["10.0.0.0/8", "10.8.0.0/16", "127.0.0.1/8", "172.16.0.0/12", "192.168.0.0/16", "::1/128"]);
    if (roll < 0.96) return `/${a.toLowerCase()}`;
    if (roll < 0.98) return `${num(rand, 1, 4)}/${num(rand, 4, 8)}=${a}`;
    return `::${hexByte(rand)}`;
  }

  function fillTape(kind, rand) {
    const out = [];
    while (out.length < PERIOD) {
      const chars = Array.from(token(kind, rand));
      const need = chars.length + (out.length ? 1 : 0);
      if (out.length + need > PERIOD) {
        while (out.length < PERIOD) out.push(" ");
        break;
      }
      if (out.length) out.push(" ");
      out.push(...chars);
    }
    return out;
  }

  function makeTape(kind, rand, shift) {
    return rotate(fillTape(kind, rand), shift * 13);
  }

  let dpr = 1;
  let cssW = 1;
  let cssH = 1;
  let tiles = [];
  let running = false;
  let lastT = 0;
  let raf = 0;
  let visible = !document.hidden;

  function makeTile(spec, width, height) {
    const tile = document.createElement("canvas");
    const cols = Math.ceil(width / COL / PERIOD) * PERIOD;
    const rows = Math.ceil(height / ROW);
    const tw = cols * COL;
    const th = rows * ROW;
    tile.width = Math.max(1, Math.round(tw * dpr));
    tile.height = Math.max(1, Math.round(th * dpr));
    const g = tile.getContext("2d");
    if (!g) return { canvas: tile, w: tw, h: th, spec, x: 0 };

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.font = `500 ${spec.size}px "IBM Plex Mono", ui-monospace, Menlo, monospace`;
    g.textBaseline = "middle";
    g.textAlign = "left";

    const rand = mulberry32(spec.seed);
    const palette = PALETTE[spec.palette];

    for (let r = 0; r < rows; r++) {
      if (((r - spec.lane) % spec.laneMod + spec.laneMod) % spec.laneMod !== 0) continue;

      const laneIndex = ((r - spec.lane) / spec.laneMod) | 0;
      const kind = spec.kinds[laneIndex % spec.kinds.length];
      const tape = makeTape(kind, rand, laneIndex);
      const color = palette[r % palette.length].slice();
      color[3] *= 0.9 + (r % 3) * 0.05;
      g.fillStyle = rgba(color);

      const y = r * ROW + ROW * 0.5;
      for (let c = 0; c < cols; c++) {
        const ch = tape[c % PERIOD];
        if (!ch || ch === " ") continue;
        g.fillText(ch, c * COL, y);
      }
    }

    return { canvas: tile, w: tw, h: th, spec, x: 0 };
  }

  function sizeCanvas(el) {
    el.width = Math.round(cssW * dpr);
    el.height = Math.round(cssH * dpr);
    el.style.width = `${cssW}px`;
    el.style.height = `${cssH}px`;
  }

  function resize() {
    const nextDpr = Math.min(devicePixelRatio || 1, coarse ? 1 : 1.5);
    const w = Math.max(1, innerWidth);
    const h = Math.max(1, innerHeight);
    if (nextDpr === dpr && w === cssW && h === cssH && tiles.length) return;
    dpr = nextDpr;
    cssW = w;
    cssH = h;
    sizeCanvas(farEl);
    sizeCanvas(nearEl);
    tiles = LAYERS.map((spec) => makeTile(spec, w, h));
    paint(0);
  }

  function clipFooter() {
    if (!foot) return;
    const top = foot.getBoundingClientRect().top;
    const hide = Math.max(0, cssH - top);
    stack.style.clipPath = hide > 0.5 ? `inset(0 0 ${hide}px 0)` : "none";
  }

  function blit(ctx, plane, dt) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    for (const tile of tiles) {
      if (tile.spec.plane !== plane) continue;
      if (!reduced) {
        tile.x = (tile.x + tile.spec.speed * dt) % tile.w;
        if (tile.x < 0) tile.x += tile.w;
      }
      const x = -tile.x;
      ctx.drawImage(tile.canvas, x, 0, tile.w, tile.h);
      ctx.drawImage(tile.canvas, x + tile.w, 0, tile.w, tile.h);
    }
  }

  function paint(dt) {
    blit(farCtx, "far", dt);
    blit(nearCtx, "near", dt);
    clipFooter();
  }

  function frame(now) {
    if (!running) return;
    if (!lastT) lastT = now;
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    paint(dt);
    raf = requestAnimationFrame(frame);
  }

  function play() {
    if (reduced || running || !visible) {
      if (reduced) paint(0);
      return;
    }
    running = true;
    lastT = 0;
    raf = requestAnimationFrame(frame);
  }

  function pause() {
    running = false;
    cancelAnimationFrame(raf);
  }

  document.addEventListener("visibilitychange", () => {
    visible = !document.hidden;
    if (visible) play();
    else pause();
  });

  addEventListener("resize", () => {
    resize();
    clipFooter();
  }, { passive: true });
  addEventListener("scroll", clipFooter, { passive: true });

  const start = () => {
    resize();
    play();
  };

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      tiles = [];
      start();
    });
  }
  start();
})();
