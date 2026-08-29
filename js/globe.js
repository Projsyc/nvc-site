import * as THREE from "three";

const NODES = [
  { id: "core", code: "LAX", lat: 34.05, lon: -118.24, role: "core" },
  { id: "tokyo", code: "TYO", lat: 35.68, lon: 139.69, role: "edge" },
  { id: "seoul", code: "SEL", lat: 37.57, lon: 126.98, role: "edge" },
  { id: "hongkong", code: "HKG", lat: 22.32, lon: 114.17, role: "edge" },
];

const ROUTES = [
  ["tokyo", "core"],
  ["seoul", "core"],
  ["hongkong", "core"],
];

const CYAN = 0x5dffc8;
const AMBER = 0xffc857;
const DOWN = 0xff5a7a;
const PACIFIC = { lat: 18, lon: -168 };
const UP = new THREE.Vector3(0, 1, 0);
const LABEL_LAYOUT = {
  core: { cx: 0, cy: 0.52, x: 0.058, y: 0.012, z: -0.022 },
  tokyo: { cx: 0, cy: 0.52, x: 0.052, y: 0.016, z: -0.022 },
  seoul: { cx: 1, cy: 0.52, x: -0.052, y: 0.016, z: -0.022 },
  hongkong: { cx: 0, cy: 0.52, x: 0.052, y: -0.028, z: -0.022 },
};

const solarU = {
  decl: { value: 0 },
  subLon: { value: 0 },
  sunDir: { value: new THREE.Vector3(0, 1, 0) },
};

const GLSL_SOLAR = /* glsl */ `
  uniform vec3 sunDir;
  float sunNL(vec3 p) {
    return dot(normalize(p), normalize(sunDir));
  }
`;

function sph(lat, lon, r = 1) {
  const la = (lat * Math.PI) / 180;
  const lo = (lon * Math.PI) / 180;
  const cl = Math.cos(la);
  return new THREE.Vector3(
    r * cl * Math.sin(lo),
    r * Math.sin(la),
    r * cl * Math.cos(lo)
  );
}

function glowTex() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.1, "rgba(255,255,255,0.4)");
  grd.addColorStop(0.28, "rgba(255,255,255,0.07)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

function circleLine(r, segs = 80) {
  const pos = new Float32Array(segs * 3);
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = Math.sin(a) * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return geo;
}

function tickLine(r, len, n = 4) {
  const pos = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const o = i * 6;
    pos[o] = c * r;
    pos[o + 1] = s * r;
    pos[o + 3] = c * (r + len);
    pos[o + 4] = s * (r + len);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return geo;
}

function codeLabel(code, align = "left") {
  const w = 320;
  const h = 96;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  ctx.font = "500 42px 'IBM Plex Mono', ui-monospace, Menlo, monospace";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#e9fff6";
  const letters = code.split("");
  const gap = 6;
  const widths = letters.map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (letters.length - 1);
  let x = align === "right" ? w - 20 - total : 20;
  const x0 = x;
  ctx.shadowColor = "rgba(0, 6, 10, 0.92)";
  ctx.shadowBlur = 8;
  letters.forEach((ch, i) => {
    ctx.fillText(ch, x, 42);
    x += widths[i] + gap;
  });
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(233,255,246,0.38)";
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(x0, 70);
  ctx.lineTo(x0 + total, 70);
  ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function inkLine(color, opacity = 0.8) {
  return new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

function inkBand(color, opacity = 0.9) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
}

function wrapLonDeg(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

function solarPosition(date = new Date()) {
  // NOAA solar eqns: δ from day-of-year; λs from UTC + equation of time.
  // Sunlight is parallel: direction S = sph(δ, λs). On the unit sphere N·S = sin(h).
  // Terminator is the great circle N·S = 0.
  const y = date.getUTCFullYear();
  const hour =
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600 +
    date.getUTCMilliseconds() / 3600000;
  const n =
    Math.floor((Date.UTC(y, date.getUTCMonth(), date.getUTCDate()) -
      Date.UTC(y, 0, 1)) / 86400000) + 1;
  const gamma = (2 * Math.PI / 365) * (n - 1 + (hour - 12) / 24);
  const eqMin = 229.18 * (
    0.000075 +
    0.001868 * Math.cos(gamma) -
    0.032077 * Math.sin(gamma) -
    0.014615 * Math.cos(2 * gamma) -
    0.040849 * Math.sin(2 * gamma)
  );
  const declRad =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  const declDeg = (declRad * 180) / Math.PI;
  const subLonDeg = wrapLonDeg(15 * (12 - hour) - eqMin / 4);
  return { n, hour, declRad, declDeg, subLonDeg, eqMin };
}

function applySolar(date, terminator) {
  const s = solarPosition(date);
  solarU.decl.value = s.declRad;
  solarU.subLon.value = (s.subLonDeg * Math.PI) / 180;
  solarU.sunDir.value.copy(sph(s.declDeg, s.subLonDeg, 1)).normalize();
  if (terminator) {
    terminator.quaternion.setFromUnitVectors(UP, solarU.sunDir.value);
  }
  return s;
}

function graticule(radius, step = 30) {
  const pos = [];
  const push = (a, b) => {
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
  };
  for (let lon = -180; lon < 180; lon += step) {
    for (let lat = -90; lat < 90; lat += 2) {
      push(sph(lat, lon, radius), sph(lat + 2, lon, radius));
    }
  }
  for (let lat = -60; lat <= 60; lat += step) {
    for (let lon = -180; lon < 180; lon += 2) {
      push(sph(lat, lon, radius), sph(lat, lon + 2, radius));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return geo;
}

function equator(radius) {
  const pos = [];
  for (let lon = -180; lon < 180; lon += 2) {
    const a = sph(0, lon, radius);
    const b = sph(0, lon + 2, radius);
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return geo;
}

function terminatorRing(radius, n = 256) {
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pos[i * 3] = Math.cos(a) * radius;
    pos[i * 3 + 1] = 0;
    pos[i * 3 + 2] = Math.sin(a) * radius;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return geo;
}

function fibonacci(n, r) {
  const pos = new Float32Array(n * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const rad = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    pos[i * 3] = Math.cos(theta) * rad * r;
    pos[i * 3 + 1] = y * r;
    pos[i * 3 + 2] = Math.sin(theta) * rad * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return geo;
}

function landGeometry(rings, radius) {
  const pos = [];
  for (let r = 0; r < rings.length; r++) {
    const flat = rings[r];
    for (let i = 0; i + 3 < flat.length; i += 2) {
      const lon0 = flat[i];
      const lat0 = flat[i + 1];
      const lon1 = flat[i + 2];
      const lat1 = flat[i + 3];
      if (Math.abs(lon1 - lon0) > 180) continue;
      const a = sph(lat0, lon0, radius);
      const b = sph(lat1, lon1, radius);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return geo;
}

function landMask(rings) {
  const w = 2048;
  const h = 1024;
  const src = document.createElement("canvas");
  src.width = w;
  src.height = h;
  const sg = src.getContext("2d");
  sg.fillStyle = "#000";
  sg.fillRect(0, 0, w, h);
  sg.fillStyle = "#fff";
  sg.beginPath();
  for (let r = 0; r < rings.length; r++) {
    const flat = rings[r];
    if (!flat || flat.length < 6) continue;
    sg.moveTo(((flat[0] + 180) / 360) * w, ((90 - flat[1]) / 180) * h);
    for (let i = 2; i + 1 < flat.length; i += 2) {
      sg.lineTo(((flat[i] + 180) / 360) * w, ((90 - flat[i + 1]) / 180) * h);
    }
    sg.closePath();
  }
  sg.fill();

  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  g.filter = "blur(0.6px)";
  g.drawImage(src, 0, 0);
  g.filter = "none";

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

function blankMask() {
  const c = document.createElement("canvas");
  c.width = 1;
  c.height = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

function sunAwarePointsMaterial(color, dayA, nightA, size) {
  return new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color(color) },
      dayA: { value: dayA },
      nightA: { value: nightA },
      size: { value: size },
      sunDir: solarU.sunDir,
    },
    vertexShader: `
      uniform float size;
      varying vec3 vObj;
      void main() {
        vObj = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = max(1.25, size * 420.0 / max(-mv.z, 0.12));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 color;
      uniform float dayA;
      uniform float nightA;
      varying vec3 vObj;
      ${GLSL_SOLAR}
      void main() {
        vec2 d = gl_PointCoord - vec2(0.5);
        if (dot(d, d) > 0.25) discard;
        float nds = sunNL(vObj);
        float day = smoothstep(-0.12, 0.08, nds);
        gl_FragColor = vec4(color, mix(nightA, dayA, day));
      }
    `,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
}

function sunAwareLineMaterial(color, dayA, nightA) {
  return new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color(color) },
      dayA: { value: dayA },
      nightA: { value: nightA },
      sunDir: solarU.sunDir,
    },
    vertexShader: `
      varying vec3 vObj;
      void main() {
        vObj = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 color;
      uniform float dayA;
      uniform float nightA;
      varying vec3 vObj;
      ${GLSL_SOLAR}
      void main() {
        float nds = sunNL(vObj);
        float day = smoothstep(-0.12, 0.08, nds);
        gl_FragColor = vec4(color, mix(nightA, dayA, day));
      }
    `,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
}

function shellMaterial(mask) {
  return new THREE.ShaderMaterial({
    uniforms: {
      mask: { value: mask },
      sunDir: solarU.sunDir,
    },
    vertexShader: `
      uniform vec3 sunDir;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vObj;
      varying vec3 vL;
      void main() {
        vObj = position;
        vN = normalize(normalMatrix * normal);
        vL = normalize(normalMatrix * sunDir);
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        vV = normalize(-view.xyz);
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: `
      uniform sampler2D mask;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vObj;
      varying vec3 vL;
      ${GLSL_SOLAR}
      void main() {
        vec3 n = normalize(vN);
        vec3 v = normalize(vV);
        vec3 p = normalize(vObj);
        float lon = atan(p.x, p.z);
        float lat = asin(clamp(p.y, -1.0, 1.0));
        vec2 uv = vec2(
          lon * 0.15915494309189535 + 0.5,
          lat * 0.3183098861837907 + 0.5
        );

        float land = texture2D(mask, uv).r;
        float nds = sunNL(p);
        float ndl = max(nds, 0.0);
        float tw = exp(-pow(nds / 0.13, 2.0));

        vec3 L = normalize(vL);
        vec3 H = normalize(L + v);
        float spec = pow(max(0.0, dot(n, H)), 72.0) * ndl;
        float lip = smoothstep(0.0, 0.35, fwidth(land) * 6.0)
          * smoothstep(0.08, 0.55, land);

        vec3 oceanN = vec3(0.003, 0.004, 0.010);
        vec3 oceanD = vec3(0.038, 0.062, 0.112);
        vec3 iceN = vec3(0.10, 0.16, 0.22);
        vec3 iceD = vec3(0.72, 0.90, 0.92);
        vec3 dusk = vec3(1.00, 0.58, 0.26);

        vec3 ocean = mix(oceanN, oceanD, ndl);
        vec3 ice = mix(iceN, iceD, ndl);
        vec3 col = mix(ocean, ice, land * mix(0.03, 0.11, ndl));
        col += dusk * tw * (0.13 + land * 0.08);
        col += iceD * land * spec * 0.12;
        col += iceD * lip * mix(0.03, 0.10, ndl);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
    toneMapped: false,
  });
}

function projectOnSphere(ray, radius, nearest = false) {
  const hit = new THREE.Vector3();
  const sphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), radius);
  if (ray.intersectSphere(sphere, hit)) return hit;
  if (!nearest) return null;
  const closest = new THREE.Vector3();
  ray.closestPointToPoint(sphere.center, closest);
  if (closest.lengthSq() < 1e-10) return null;
  return closest.setLength(radius);
}

function arcPoints(a, b, n = 64, lift = 0.16) {
  const pts = [];
  const va = a.clone().normalize();
  const vb = b.clone().normalize();
  const out = new THREE.Vector3();
  const dot = THREE.MathUtils.clamp(va.dot(vb), -1, 1);
  const th = Math.acos(dot);
  const sin = Math.sin(th) || 1;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (th < 1e-4) out.copy(va).lerp(vb, t);
    else {
      out.copy(va).multiplyScalar(Math.sin((1 - t) * th) / sin)
        .addScaledVector(vb, Math.sin(t * th) / sin);
    }
    out.normalize();
    const alt = 1 + Math.sin(t * Math.PI) * lift;
    pts.push(out.clone().multiplyScalar(alt));
  }
  return pts;
}

function init() {
  const canvas = document.getElementById("orbit");
  const wrap = document.getElementById("orbitWrap");
  if (!canvas || !wrap) return;

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
  } catch {
    wrap.classList.add("is-fallback");
    return;
  }

  if (!renderer.getContext()) {
    wrap.classList.add("is-fallback");
    return;
  }

  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 20);
  camera.position.set(0, 0, 2.55);

  const root = new THREE.Group();
  scene.add(root);

  const shellMat = shellMaterial(blankMask());
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(1, 96, 64),
    shellMat
  );
  root.add(shell);

  const grid = new THREE.LineSegments(
    graticule(1.001, 30),
    sunAwareLineMaterial(CYAN, 0.14, 0.02)
  );
  root.add(grid);

  const eq = new THREE.LineSegments(
    equator(1.004),
    sunAwareLineMaterial(CYAN, 0.55, 0.08)
  );
  root.add(eq);

  const terminator = new THREE.Group();
  const termGlow = new THREE.LineLoop(
    terminatorRing(1.012, 256),
    new THREE.LineBasicMaterial({
      color: AMBER,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  const termEdge = new THREE.LineLoop(
    terminatorRing(1.013, 256),
    new THREE.LineBasicMaterial({
      color: CYAN,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  terminator.add(termGlow);
  terminator.add(termEdge);
  terminator.renderOrder = 2;
  root.add(terminator);

  applySolar(new Date(), terminator);

  const dust = new THREE.Points(
    fibonacci(420, 1.002),
    sunAwarePointsMaterial(CYAN, 0.14, 0.03, 0.01)
  );
  root.add(dust);

  const coasts = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    sunAwareLineMaterial(0xc8fff0, 0.42, 0.045)
  );
  root.add(coasts);
  fetch("data/land-110m.json")
    .then((res) => (res.ok ? res.json() : []))
    .then((rings) => {
      if (!Array.isArray(rings) || !rings.length) return;
      coasts.geometry.dispose();
      coasts.geometry = landGeometry(rings, 1.006);
      const tex = landMask(rings);
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy() || 4);
      const prev = shellMat.uniforms.mask.value;
      shellMat.uniforms.mask.value = tex;
      if (prev && prev !== tex) prev.dispose();
    })
    .catch(() => {});

  const atm = new THREE.Mesh(
    new THREE.SphereGeometry(1.07, 48, 32),
    new THREE.ShaderMaterial({
      uniforms: {
        color: { value: new THREE.Color(CYAN) },
        sunDir: solarU.sunDir,
      },
      vertexShader: `
        varying vec3 vN;
        varying vec3 vW;
        varying vec3 vObj;
        void main() {
          vObj = position;
          vN = normalize(normalMatrix * normal);
          vec4 w = modelViewMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * w;
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        varying vec3 vN;
        varying vec3 vW;
        varying vec3 vObj;
        ${GLSL_SOLAR}
        void main() {
          vec3 n = normalize(vN);
          vec3 v = normalize(-vW);
          float f = pow(1.0 - abs(dot(n, v)), 3.4);
          float nds = sunNL(vObj);
          float sun = smoothstep(-0.15, 0.55, nds);
          gl_FragColor = vec4(color, f * mix(0.04, 0.28, sun));
        }
      `,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  root.add(atm);

  const spriteTex = glowTex();
  const octaGeo = new THREE.OctahedronGeometry(1, 0);
  const nodeGroup = new THREE.Group();
  nodeGroup.renderOrder = 3;
  root.add(nodeGroup);

  const nodeMap = new Map();
  const pickables = [];

  NODES.forEach((n, ni) => {
    const g = new THREE.Group();
    g.position.copy(sph(n.lat, n.lon, 1));
    g.lookAt(0, 0, 0);

    const isCore = n.role === "core";
    const color = isCore ? CYAN : AMBER;
    const rOuter = isCore ? 0.038 : 0.028;
    const rInner = 0.02;
    const hw = 0.0022;
    const stem = isCore ? 0.028 : 0.02;
    const crystalR = isCore ? 0.011 : 0.0076;
    const glowBase = isCore ? 0.155 : 0.11;
    const lay = LABEL_LAYOUT[n.id];

    const bandMat = inkBand(color, isCore ? 0.95 : 0.82);
    const tickMat = inkLine(color, 0.78);
    const stemMat = inkLine(color, 0.7);
    const pingMat = inkLine(color, 0);
    const selMat = inkBand(color, 0);
    const crystalMat = new THREE.MeshBasicMaterial({
      color,
      toneMapped: false,
      depthTest: false,
    });
    const lampMat = inkBand(color, 0.88);
    const glowMat = new THREE.SpriteMaterial({
      map: spriteTex,
      color,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const labelMat = new THREE.SpriteMaterial({
      map: codeLabel(n.code, lay.cx >= 1 ? "right" : "left"),
      color: 0xffffff,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    const pad = new THREE.Group();
    pad.position.z = -0.01;

    const outer = new THREE.Mesh(
      new THREE.RingGeometry(rOuter - hw, rOuter + hw, 64),
      bandMat
    );
    pad.add(outer);
    if (isCore) {
      pad.add(new THREE.Mesh(
        new THREE.RingGeometry(rInner - hw, rInner + hw, 48),
        bandMat
      ));
    }

    const lamp = new THREE.Mesh(
      new THREE.CircleGeometry(isCore ? 0.0048 : 0.0032, 20),
      lampMat
    );
    pad.add(lamp);

    const ticks = new THREE.LineSegments(tickLine(rOuter, isCore ? 0.008 : 0.006), tickMat);
    pad.add(ticks);

    const ping = new THREE.LineLoop(circleLine(rOuter), pingMat);
    pad.add(ping);

    const select = new THREE.Mesh(
      new THREE.RingGeometry(rOuter * 1.42 - hw, rOuter * 1.42 + hw, 64),
      selMat
    );
    pad.add(select);
    g.add(pad);

    const mast = new THREE.Line(
      new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.Float32BufferAttribute([0, 0, -0.01, 0, 0, -stem], 3)
      ),
      stemMat
    );
    g.add(mast);

    const crystal = new THREE.Mesh(octaGeo, crystalMat);
    crystal.scale.setScalar(crystalR);
    crystal.position.z = -stem;
    g.add(crystal);

    const glow = new THREE.Sprite(glowMat);
    glow.position.z = -stem;
    glow.scale.setScalar(glowBase);
    glow.renderOrder = 4;
    g.add(glow);

    const label = new THREE.Sprite(labelMat);
    label.center.set(lay.cx, lay.cy);
    label.position.set(lay.x, lay.y, lay.z);
    label.scale.set(0.2, 0.06, 1);
    label.renderOrder = 6;
    g.add(label);

    const collider = new THREE.Mesh(
      new THREE.SphereGeometry(isCore ? 0.1 : 0.08, 10, 10),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
    );
    collider.position.z = -stem * 0.45;
    collider.userData.id = n.id;
    g.add(collider);

    nodeGroup.add(g);
    pickables.push(collider);

    nodeMap.set(n.id, {
      ...n,
      group: g,
      ticks,
      ping,
      select,
      crystal,
      glow,
      label,
      color,
      live: n.role === "core",
      crystalR,
      glowBase,
      phase: ni * 0.27,
      mats: [bandMat, tickMat, stemMat, pingMat, selMat, crystalMat, lampMat, glowMat],
      pingMat,
      selMat,
      tickMat,
      bandMat,
      labelMat,
    });
  });

  const routeGroup = new THREE.Group();
  root.add(routeGroup);
  const packets = [];

  ROUTES.forEach(([fromId, toId], ri) => {
    const a = sph(nodeMap.get(fromId).lat, nodeMap.get(fromId).lon);
    const b = sph(nodeMap.get(toId).lat, nodeMap.get(toId).lon);
    const pts = arcPoints(a, b);
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({
        color: AMBER,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      })
    );
    routeGroup.add(line);

    const nPkt = reduced ? 0 : 2;
    for (let i = 0; i < nPkt; i++) {
      const pkt = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.007, 0),
        new THREE.MeshBasicMaterial({ color: ri === 0 ? CYAN : AMBER, toneMapped: false })
      );
      routeGroup.add(pkt);
      packets.push({
        mesh: pkt,
        pts,
        t: i / nPkt,
        speed: 0.06 + ri * 0.008,
      });
    }
  });

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const euler = new THREE.Euler(0, 0, 0, "XYZ");
  const grabLocal = new THREE.Vector3();
  const grabWorld = new THREE.Vector3();
  const grabTarget = new THREE.Vector3();
  const invRoot = new THREE.Quaternion();
  const viewDir = new THREE.Vector3();
  const qFrom = new THREE.Quaternion();
  const qTo = new THREE.Quaternion();
  const nodeWorld = new THREE.Vector3();
  const nodeOut = new THREE.Vector3();
  const nodeToCam = new THREE.Vector3();
  const axisTmp = new THREE.Vector3();
  const crossTmp = new THREE.Vector3();
  let yaw = THREE.MathUtils.degToRad(-PACIFIC.lon);
  let pitch = THREE.MathUtils.degToRad(PACIFIC.lat);
  let spinRate = 0;
  let spinP = 0;
  const MAX_YAW_STEP = 0.28;
  const MAX_PITCH_STEP = 0.22;
  const MAX_SPIN = 0.48;
  const MAX_SPIN_P = 0.32;
  const PITCH_LIM = 1.2;

  function poseOf(latDeg, lonDeg, target) {
    target.setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(latDeg),
      THREE.MathUtils.degToRad(-lonDeg),
      0,
      "XYZ"
    ));
    return target;
  }

  function applyView() {
    euler.set(pitch, yaw, 0, "XYZ");
    root.quaternion.setFromEuler(euler);
  }

  function syncYawPitchFromFacing() {
    invRoot.copy(root.quaternion).invert();
    viewDir.set(0, 0, 1).applyQuaternion(invRoot);
    pitch = Math.asin(THREE.MathUtils.clamp(viewDir.y, -1, 1));
    yaw = -Math.atan2(viewDir.x, viewDir.z);
  }

  function spinClear() {
    spinRate = 0;
    spinP = 0;
  }

  function applyYaw(angle, dt) {
    const a = THREE.MathUtils.clamp(angle, -MAX_YAW_STEP, MAX_YAW_STEP);
    if (Math.abs(a) < 1e-6) return;
    yaw += a;
    applyView();
    if (dt > 1e-4) {
      spinRate = THREE.MathUtils.clamp(
        spinRate * 0.72 + (a / dt) * 0.28,
        -MAX_SPIN,
        MAX_SPIN
      );
    }
  }

  function applyPitch(angle, dt) {
    const next = THREE.MathUtils.clamp(pitch + angle, -PITCH_LIM, PITCH_LIM);
    const d = THREE.MathUtils.clamp(next - pitch, -MAX_PITCH_STEP, MAX_PITCH_STEP);
    if (Math.abs(d) < 1e-6) return;
    pitch += d;
    applyView();
    if (dt > 1e-4) {
      spinP = THREE.MathUtils.clamp(
        spinP * 0.72 + (d / dt) * 0.28,
        -MAX_SPIN_P,
        MAX_SPIN_P
      );
    }
  }

  applyView();

  let anim = null;
  let dragging = false;
  let moved = false;
  let grabbing = false;
  let lastX = 0;
  let lastY = 0;
  let downX = 0;
  let downY = 0;
  let lastMoveT = 0;
  let idleAt = performance.now() + 2400;
  let visible = true;
  let running = false;
  let selected = "core";
  const AUTO = 0.045;
  const SENS = 0.0055;

  const hitEl = document.createElement("div");
  hitEl.className = "hero-orbit-hit";
  hitEl.setAttribute("aria-hidden", "true");
  wrap.appendChild(hitEl);

  function pointerRay(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    pointerNdc.x = ((clientX - r.left) / r.width) * 2 - 1;
    pointerNdc.y = -((clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    return raycaster.ray;
  }

  function size() {
    const r = wrap.getBoundingClientRect();
    const w = Math.max(1, r.width);
    const h = Math.max(1, r.height);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const fill = matchMedia("(min-width: 861px)").matches ? 1.0 : 0.86;
    camera.position.z = fill / (Math.tan(vFov / 2) * Math.min(1, camera.aspect));
    const d = Math.min(w, h) / fill;
    hitEl.style.width = `${d}px`;
    hitEl.style.height = `${d}px`;
  }

  function paintNode(id, live) {
    const n = nodeMap.get(id);
    if (!n) return;
    n.live = live;
    const color = live ? CYAN : n.role === "core" ? DOWN : AMBER;
    n.color = color;
    n.mats.forEach((m) => m.color.setHex(color));
  }

  function focus(id, duration = reduced ? 0 : 880) {
    const n = nodeMap.get(id) || NODES.find((x) => x.id === id);
    if (!n) return;
    selected = id;
    spinClear();
    idleAt = performance.now() + 4200;
    qFrom.copy(root.quaternion);
    poseOf(n.lat, n.lon, qTo);
    if (qFrom.dot(qTo) < 0) {
      qTo.x = -qTo.x;
      qTo.y = -qTo.y;
      qTo.z = -qTo.z;
      qTo.w = -qTo.w;
    }
    if (duration <= 0) {
      root.quaternion.copy(qTo);
      syncYawPitchFromFacing();
      anim = null;
      return;
    }
    anim = {
      t0: performance.now(),
      ms: duration,
      slerp: true,
      from: qFrom.clone(),
      to: qTo.clone(),
    };
  }

  function pick(clientX, clientY) {
    pointerRay(clientX, clientY);
    const hits = raycaster.intersectObjects(pickables, false);
    return hits[0] && hits[0].object.userData.id;
  }

  function globeHit(clientX, clientY, nearest = false) {
    return projectOnSphere(pointerRay(clientX, clientY), 1, nearest);
  }

  function onTouchStart(e) {
    const t = e.changedTouches[0];
    if (!t) return;
    if (e.currentTarget === hitEl || globeHit(t.clientX, t.clientY)) e.preventDefault();
  }

  let captureEl = null;

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const onDisc = e.currentTarget === hitEl;
    const hit = globeHit(e.clientX, e.clientY, true);
    if (!onDisc && e.pointerType !== "mouse" && !globeHit(e.clientX, e.clientY, false)) return;
    dragging = true;
    moved = false;
    grabbing = false;
    lastX = e.clientX;
    lastY = e.clientY;
    downX = e.clientX;
    downY = e.clientY;
    lastMoveT = performance.now();
    spinClear();
    anim = null;
    if (hit) {
      invRoot.copy(root.quaternion).invert();
      grabLocal.copy(hit).applyQuaternion(invRoot);
      grabbing = true;
    }
    captureEl = e.currentTarget;
    try { captureEl.setPointerCapture(e.pointerId); } catch {}
    if (e.cancelable) e.preventDefault();
  }

  function onMove(e) {
    if (!dragging) return;
    const now = performance.now();
    const dt = Math.max(0.008, (now - lastMoveT) / 1000);
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 8) moved = true;
    lastX = e.clientX;
    lastY = e.clientY;
    lastMoveT = now;

    const hit = projectOnSphere(pointerRay(e.clientX, e.clientY), 1);
    if (grabbing && hit) {
      axisTmp.copy(UP).applyQuaternion(root.quaternion);
      grabWorld.copy(grabLocal).applyQuaternion(root.quaternion);
      grabTarget.copy(hit);
      grabWorld.addScaledVector(axisTmp, -grabWorld.dot(axisTmp));
      grabTarget.addScaledVector(axisTmp, -grabTarget.dot(axisTmp));
      const fromLen = grabWorld.length();
      const toLen = grabTarget.length();
      if (fromLen > 0.14 && toLen > 0.14) {
        grabWorld.multiplyScalar(1 / fromLen);
        grabTarget.multiplyScalar(1 / toLen);
        applyYaw(
          Math.atan2(axisTmp.dot(crossTmp.copy(grabWorld).cross(grabTarget)), grabWorld.dot(grabTarget)),
          dt
        );
      } else if (dx) {
        applyYaw(dx * SENS, dt);
      }
    } else if (dx) {
      applyYaw(dx * SENS, dt);
    }
    if (dy) applyPitch(dy * SENS * 0.82, dt);
  }

  function onUp(e) {
    if (!dragging) return;
    dragging = false;
    grabbing = false;
    idleAt = performance.now() + 2400;
    try { (captureEl || canvas).releasePointerCapture(e.pointerId); } catch {}
    captureEl = null;
    if (!moved) {
      const id = pick(e.clientX, e.clientY);
      if (id) {
        focus(id);
        document.dispatchEvent(new CustomEvent("nvc:focus-node", { detail: { id } }));
      }
    }
  }

  function bindSpin(el) {
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", (e) => {
      if (dragging && e.cancelable) e.preventDefault();
    }, { passive: false });
  }
  bindSpin(canvas);
  bindSpin(hitEl);
  canvas.addEventListener("dblclick", () => focus("core"));
  hitEl.addEventListener("dblclick", () => focus("core"));

  addEventListener("resize", size);
  const ro = new ResizeObserver(size);
  ro.observe(wrap);
  size();

  const io = new IntersectionObserver((entries) => {
    visible = entries[0] && entries[0].isIntersecting && entries[0].intersectionRatio > 0.08;
  }, { threshold: [0, 0.08, 0.2] });
  io.observe(wrap);

  let last = performance.now();
  function frame(now) {
    running = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!visible || wrap.classList.contains("is-past")) return;

    applySolar(new Date(), terminator);

    if (anim && anim.slerp) {
      const t = Math.min(1, (now - anim.t0) / anim.ms);
      const e = easeInOut(t);
      root.quaternion.copy(anim.from).slerp(anim.to, e);
      if (t >= 1) {
        root.quaternion.copy(anim.to);
        syncYawPitchFromFacing();
        anim = null;
      }
    } else if (!dragging) {
      if (Math.abs(spinRate) > 0.018 || Math.abs(spinP) > 0.018) {
        if (Math.abs(spinRate) > 0.018) {
          yaw += spinRate * dt;
          spinRate *= Math.exp(-dt / 0.26);
        }
        if (Math.abs(spinP) > 0.018) {
          pitch = THREE.MathUtils.clamp(pitch + spinP * dt, -PITCH_LIM, PITCH_LIM);
          spinP *= Math.exp(-dt / 0.22);
        }
        applyView();
        idleAt = now + 900;
      } else if (!reduced && now > idleAt) {
        spinClear();
        yaw += AUTO * dt;
        applyView();
      }
    }

    const pulse = reduced ? 1 : 1 + Math.sin(now * 0.0028) * 0.06;
    nodeMap.forEach((n) => {
      n.group.getWorldPosition(nodeWorld);
      nodeOut.copy(nodeWorld).normalize();
      nodeToCam.copy(camera.position).sub(nodeWorld).normalize();
      const facing = nodeOut.dot(nodeToCam);
      const vis = THREE.MathUtils.smoothstep(facing, -0.02, 0.18);
      n.group.visible = vis > 0.04;
      if (!n.group.visible) return;

      const on = n.id === selected;
      n.crystal.scale.setScalar(n.crystalR * pulse);
      n.glow.scale.setScalar(n.glowBase * pulse);
      n.bandMat.opacity = (on ? 0.98 : 0.72) * vis;
      n.tickMat.opacity = (on ? 0.9 : 0.55) * vis;
      n.labelMat.opacity = (on ? 1 : 0.72) * vis;
      n.selMat.opacity = (on ? 0.62 : 0) * vis;
      n.ticks.rotation.z = on && !reduced ? now * 0.00038 : 0;

      if (reduced) {
        n.ping.visible = false;
      } else {
        n.ping.visible = true;
        const t = ((now * 0.0004 + n.phase) % 1 + 1) % 1;
        n.ping.scale.setScalar(1 + t * 2.15);
        n.pingMat.opacity = (1 - t) * (on ? 0.5 : n.live ? 0.28 : 0.14) * vis;
      }
    });

    packets.forEach((p) => {
      p.t = ((p.t + p.speed * Math.max(0, dt)) % 1 + 1) % 1;
      const pts = p.pts;
      if (!pts || pts.length < 2) return;
      const u = p.t * (pts.length - 1);
      const i0 = Math.min(pts.length - 2, Math.max(0, Math.floor(u)));
      p.mesh.position.lerpVectors(pts[i0], pts[i0 + 1], u - i0);
    });

    renderer.render(scene, camera);
  }

  running = requestAnimationFrame(frame);
  wrap.classList.add("is-live");

  const cached = window.nvcLastStatus;
  if (cached) paintNode("core", !!cached.ok);

  document.addEventListener("nvc:status", (e) => {
    const data = e.detail && e.detail.data;
    const ok = data && data.ok;
    paintNode("core", !!ok);
    ["tokyo", "seoul", "hongkong"].forEach((id) => paintNode(id, false));
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(running);
      running = 0;
    } else if (!running) {
      last = performance.now();
      running = requestAnimationFrame(frame);
    }
  });

  window.nvcOrbit = {
    focus,
    pose() {
      syncYawPitchFromFacing();
      axisTmp.copy(UP).applyQuaternion(root.quaternion);
      return { yaw, pitch, axis: [axisTmp.x, axisTmp.y, axisTmp.z] };
    },
    setCoreLive(live) { paintNode("core", live); },
    solar() {
      const s = solarPosition(new Date());
      const alt = (lat, lon) => {
        const d = Math.PI / 180;
        const sinh =
          Math.sin(lat * d) * Math.sin(s.declRad) +
          Math.cos(lat * d) * Math.cos(s.declRad) *
          Math.cos((lon - s.subLonDeg) * d);
        return (Math.asin(Math.max(-1, Math.min(1, sinh))) * 180) / Math.PI;
      };
      return {
        decl: s.declDeg,
        subLon: s.subLonDeg,
        dayOfYear: s.n,
        utcHour: s.hour,
        nodes: Object.fromEntries(
          NODES.map((n) => [n.id, { alt: alt(n.lat, n.lon), day: alt(n.lat, n.lon) > 0 }])
        ),
      };
    },
  };
}

init();
