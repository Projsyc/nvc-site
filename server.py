#!/usr/bin/env python3
"""nvc.ac static site + live core probes. Bind loopback; Cloudflare tunnel in front."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
UA = "nvc-probe/1.0"
CACHE_TTL = 60.0
HTTP_TIMEOUT = 1.8
DENY_SUFFIXES = {".py", ".pyc", ".pyo", ".service", ".sh"}

HTTP_CHECKS = (
    ("new-api", "http://127.0.0.1:3000/", "public"),
    ("docs-agent", "http://127.0.0.1:8787/healthz", "public"),
    ("umami", "http://127.0.0.1:3001/", "public"),
    ("cliproxy", "http://127.0.0.1:8317/healthz", "loopback"),
    ("aipm", "https://aipm.ac/", "public"),
)
CONTAINER_ALIASES = {
    "new-api": ("new-api",),
    "docs-agent": ("agent-server-agent-server-1", "aipm-agent-server", "agent-server"),
    "umami": ("umami",),
    "cliproxy": ("cli-proxy-api",),
}
UNITS = {
    "ingress": ("nginx", "cloudflared"),
    "mesh-node": ("x-ui",),
    "mail": ("stalwart", "stalwart-mail"),
}
MAIL_PORTS = (25, 143, 587, 993, 4190)

_cache = {"ts": 0.0, "payload": None}
_lock = threading.Lock()
_cpu_lock = threading.Lock()
_cpu_sample: tuple[int, int] | None = None


def _run(cmd: list[str], timeout: float = 1.5) -> str:
    try:
        return subprocess.check_output(cmd, text=True, stderr=subprocess.DEVNULL, timeout=timeout)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return ""


def _linux_cpu_sample() -> tuple[int, int] | None:
    """Return (total, idle) jiffies for the aggregate Linux CPU."""
    try:
        fields = [int(v) for v in Path("/proc/stat").read_text().splitlines()[0].split()[1:9]]
    except (OSError, ValueError, IndexError):
        return None
    if len(fields) < 4:
        return None
    idle = fields[3] + (fields[4] if len(fields) > 4 else 0)
    return sum(fields), idle


def cpu_metrics() -> dict:
    """Measure host CPU use without an external psutil dependency."""
    global _cpu_sample
    cores = os.cpu_count() or 1
    usage_pct = None

    with _cpu_lock:
        current = _linux_cpu_sample()
        if current is not None:
            previous = _cpu_sample
            if previous is None:
                # Prime the first response with a real interval instead of a synthetic value.
                time.sleep(0.12)
                previous = current
                current = _linux_cpu_sample() or current
            _cpu_sample = current
            total_delta = current[0] - previous[0]
            idle_delta = current[1] - previous[1]
            if total_delta > 0:
                usage_pct = max(0.0, min(100.0, (1.0 - idle_delta / total_delta) * 100.0))

    if usage_pct is None:
        # Portable preview fallback. macOS ps reports 100% per logical CPU.
        values = []
        for raw in _run(["ps", "-A", "-o", "%cpu="], timeout=1.0).split():
            try:
                values.append(float(raw))
            except ValueError:
                pass
        if values:
            usage_pct = max(0.0, min(100.0, sum(values) / cores))

    return {
        "usage_pct": round(usage_pct, 1) if usage_pct is not None else None,
        "logical_cores": cores,
    }


def memory_metrics() -> dict:
    total_kb = available_kb = swap_total_kb = swap_free_kb = 0
    try:
        info = {}
        for line in Path("/proc/meminfo").read_text().splitlines():
            key, value, *_ = line.split()
            info[key.rstrip(":")] = int(value)
        total_kb = info.get("MemTotal", 0)
        available_kb = info.get("MemAvailable", 0)
        swap_total_kb = info.get("SwapTotal", 0)
        swap_free_kb = info.get("SwapFree", 0)
    except (OSError, ValueError):
        pass

    if not total_kb:
        total_raw = _run(["sysctl", "-n", "hw.memsize"]).strip()
        vm_stat = _run(["vm_stat"])
        if total_raw.isdigit():
            total_kb = int(total_raw) // 1024
        if total_kb and vm_stat:
            page_size = 4096
            first_line = vm_stat.splitlines()[0] if vm_stat.splitlines() else ""
            for token in first_line.replace("(", " ").replace(")", " ").split():
                if token.isdigit():
                    page_size = int(token)
                    break
            pages = {}
            for line in vm_stat.splitlines()[1:]:
                if ":" not in line:
                    continue
                key, raw = line.split(":", 1)
                raw = raw.strip().rstrip(".")
                if raw.isdigit():
                    pages[key] = int(raw)
            available_pages = sum(
                pages.get(key, 0)
                for key in ("Pages free", "Pages inactive", "Pages speculative", "Pages purgeable")
            )
            available_kb = available_pages * page_size // 1024

    used_kb = max(0, total_kb - available_kb)
    used_pct = (used_kb * 100.0 / total_kb) if total_kb else None
    return {
        "total_mb": total_kb // 1024,
        "used_mb": used_kb // 1024,
        "available_mb": available_kb // 1024,
        "used_pct": round(used_pct, 1) if used_pct is not None else None,
        "swap_total_mb": swap_total_kb // 1024,
        "swap_used_mb": max(0, swap_total_kb - swap_free_kb) // 1024,
    }


def disk_metrics() -> dict:
    try:
        usage = shutil.disk_usage("/")
    except OSError:
        return {
            "mount": "/",
            "total_gb": 0,
            "used_gb": 0,
            "free_gb": 0,
            "used_pct": None,
        }
    gib = 1024 ** 3
    used_pct = usage.used * 100.0 / usage.total if usage.total else None
    return {
        "mount": "/",
        "total_gb": round(usage.total / gib, 1),
        "used_gb": round(usage.used / gib, 1),
        "free_gb": round(usage.free / gib, 1),
        "used_pct": round(used_pct, 1) if used_pct is not None else None,
    }


def temperature_metrics() -> dict:
    """Read kernel-exposed thermal sensors; cloud hypervisors often expose none."""
    sensors: list[dict] = []

    hwmon_root = Path("/sys/class/hwmon")
    try:
        hwmons = sorted(hwmon_root.glob("hwmon*")) if hwmon_root.exists() else []
    except OSError:
        hwmons = []
    for hwmon in hwmons:
        try:
            chip = (hwmon / "name").read_text().strip()
        except OSError:
            chip = hwmon.name
        try:
            inputs = sorted(hwmon.glob("temp*_input"))
        except OSError:
            inputs = []
        for input_path in inputs:
            try:
                raw = float(input_path.read_text().strip())
                celsius = raw / 1000.0 if abs(raw) > 200 else raw
                if not -20 <= celsius <= 150:
                    continue
                label_path = input_path.with_name(input_path.name.replace("_input", "_label"))
                try:
                    label = label_path.read_text().strip()
                except OSError:
                    label = input_path.name.replace("_input", "")
                sensors.append({"label": f"{chip} · {label}", "celsius": round(celsius, 1)})
            except (OSError, ValueError):
                continue

    thermal_root = Path("/sys/class/thermal")
    try:
        zones = sorted(thermal_root.glob("thermal_zone*")) if thermal_root.exists() else []
    except OSError:
        zones = []
    for zone in zones:
        try:
            raw = float((zone / "temp").read_text().strip())
            celsius = raw / 1000.0 if abs(raw) > 200 else raw
            if not -20 <= celsius <= 150:
                continue
            try:
                label = (zone / "type").read_text().strip()
            except OSError:
                label = zone.name
            sensors.append({"label": label, "celsius": round(celsius, 1)})
        except (OSError, ValueError):
            continue

    unique = {}
    for sensor in sensors:
        unique[(sensor["label"].lower(), sensor["celsius"])] = sensor
    sensors = list(unique.values())

    def priority(sensor: dict) -> tuple[int, str]:
        label = sensor["label"].lower()
        if any(token in label for token in ("package", "tctl", "tdie", "cpu")):
            rank = 0
        elif "core" in label:
            rank = 1
        elif "nvme" in label:
            rank = 3
        else:
            rank = 2
        return rank, label

    sensors.sort(key=priority)
    primary = sensors[0] if sensors else None
    return {
        "available": primary is not None,
        "celsius": primary["celsius"] if primary else None,
        "label": primary["label"] if primary else None,
        "sensors": sensors[:8],
    }


def _gpu_num(raw: str):
    text = (raw or "").strip()
    if not text or text.upper() in {"N/A", "[N/A]", "NA", "[NOT SUPPORTED]"}:
        return None
    try:
        return float(text.replace("%", "").replace("MiB", "").replace("W", "").strip())
    except ValueError:
        return None


def _gpu_unavailable() -> dict:
    return {
        "available": False,
        "name": None,
        "usage_pct": None,
        "mem_used_mb": None,
        "mem_total_mb": None,
        "mem_used_pct": None,
        "celsius": None,
        "count": 0,
        "devices": [],
    }


def gpu_metrics() -> dict:
    """
    Probe NVIDIA via nvidia-smi, then AMD via sysfs. Time-boxed so a missing
    driver cannot stall /api/status. No GPU → available=false, never fake load.
    """
    devices: list[dict] = []
    raw = _run(
        [
            "nvidia-smi",
            "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu",
            "--format=csv,noheader,nounits",
        ],
        timeout=1.2,
    )
    for line in raw.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 5:
            continue
        name, util_s, used_s, total_s, temp_s = parts[:5]
        util = _gpu_num(util_s)
        used_n = _gpu_num(used_s)
        total_n = _gpu_num(total_s)
        temp = _gpu_num(temp_s)
        mem_pct = None
        if used_n is not None and total_n and total_n > 0:
            mem_pct = round(100.0 * used_n / total_n, 1)
        devices.append(
            {
                "vendor": "nvidia",
                "name": name or "NVIDIA GPU",
                "usage_pct": None if util is None else round(util, 1),
                "mem_used_mb": None if used_n is None else int(round(used_n)),
                "mem_total_mb": None if total_n is None else int(round(total_n)),
                "mem_used_pct": mem_pct,
                "celsius": None if temp is None else round(temp, 1),
            }
        )

    if not devices:
        drm = Path("/sys/class/drm")
        try:
            busy_paths = sorted(drm.glob("card*/device/gpu_busy_percent")) if drm.exists() else []
        except OSError:
            busy_paths = []
        for index, busy_path in enumerate(busy_paths):
            device_dir = busy_path.parent
            try:
                usage = round(float(busy_path.read_text().strip()), 1)
            except (OSError, ValueError):
                continue
            used_mb = total_mb = mem_pct = temp_c = None
            vram_used = device_dir / "mem_info_vram_used"
            vram_total = device_dir / "mem_info_vram_total"
            try:
                if vram_used.exists() and vram_total.exists():
                    used_b = int(vram_used.read_text().strip())
                    total_b = int(vram_total.read_text().strip())
                    used_mb = round(used_b / (1024 * 1024))
                    total_mb = round(total_b / (1024 * 1024))
                    if total_b > 0:
                        mem_pct = round(100.0 * used_b / total_b, 1)
            except (OSError, ValueError):
                pass
            try:
                hwmon_temps = sorted((device_dir / "hwmon").glob("hwmon*/temp1_input"))
            except OSError:
                hwmon_temps = []
            if hwmon_temps:
                try:
                    milli = int(hwmon_temps[0].read_text().strip())
                    if milli > 0:
                        temp_c = round(milli / 1000, 1)
                except (OSError, ValueError):
                    pass
            devices.append(
                {
                    "vendor": "amd",
                    "name": f"AMD GPU {index}",
                    "usage_pct": usage,
                    "mem_used_mb": used_mb,
                    "mem_total_mb": total_mb,
                    "mem_used_pct": mem_pct,
                    "celsius": temp_c,
                }
            )

    if not devices:
        return _gpu_unavailable()

    usages = [d["usage_pct"] for d in devices if d["usage_pct"] is not None]
    used_mbs = [d["mem_used_mb"] for d in devices if d["mem_used_mb"] is not None]
    total_mbs = [d["mem_total_mb"] for d in devices if d["mem_total_mb"] is not None]
    temps = [d["celsius"] for d in devices if d["celsius"] is not None]
    used_sum = sum(used_mbs) if used_mbs else None
    total_sum = sum(total_mbs) if total_mbs else None
    mem_pct = None
    if used_sum is not None and total_sum:
        mem_pct = round(100.0 * used_sum / total_sum, 1)
    return {
        "available": True,
        "name": devices[0]["name"],
        "usage_pct": round(sum(usages) / len(usages), 1) if usages else None,
        "mem_used_mb": used_sum,
        "mem_total_mb": total_sum,
        "mem_used_pct": mem_pct,
        "celsius": max(temps) if temps else None,
        "count": len(devices),
        "devices": devices[:8],
    }


def host_metrics() -> dict:
    uptime_sec = None
    load = [0.0, 0.0, 0.0]

    try:
        uptime_sec = int(float(Path("/proc/uptime").read_text().split()[0]))
    except OSError:
        out = _run(["sysctl", "-n", "kern.boottime"])
        if out:
            for tok in out.replace(",", " ").split():
                if tok.isdigit():
                    uptime_sec = max(0, int(time.time()) - int(tok))
                    break

    try:
        load = [float(x) for x in Path("/proc/loadavg").read_text().split()[:3]]
    except OSError:
        out = _run(["sysctl", "-n", "vm.loadavg"])
        parts = [p for p in out.replace("{", " ").replace("}", " ").split() if p.replace(".", "", 1).isdigit()]
        if len(parts) >= 3:
            load = [float(x) for x in parts[:3]]

    return {
        "status": "live",
        "uptime_sec": uptime_sec,
        "load": [round(x, 2) for x in load],
        "cpu": cpu_metrics(),
        "mem": memory_metrics(),
        "disk": disk_metrics(),
        "temperature": temperature_metrics(),
        "gpu": gpu_metrics(),
        "born": "2026-08-02",
    }


def http_probe(url: str) -> dict:
    t0 = time.perf_counter()
    req = urllib.request.Request(url, method="GET", headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
            body = resp.read(8192)
            code = getattr(resp, "status", 200)
        ms = int((time.perf_counter() - t0) * 1000)
        out = {"ok": 200 <= code < 400, "code": code, "latency_ms": ms}
        if body[:1] == b"{":
            try:
                out["json"] = json.loads(body.decode("utf-8", "replace"))
            except json.JSONDecodeError:
                pass
        return out
    except Exception:
        ms = int((time.perf_counter() - t0) * 1000)
        return {"ok": False, "code": 0, "latency_ms": ms}


def docker_names() -> set[str] | None:
    listed = _run(["docker", "ps", "--format", "{{.Names}}"], timeout=0.8)
    if listed:
        return {line.strip() for line in listed.splitlines() if line.strip()}
    if not _run(["docker", "info"], timeout=0.8):
        return None
    return set()


def docker_running(names: tuple[str, ...], running: set[str] | None) -> bool | None:
    if not names:
        return None
    if running is None:
        return None
    return any(n in running for n in names)


def unit_active(units: tuple[str, ...]) -> bool | None:
    saw = False
    for unit in units:
        out = _run(["systemctl", "is-active", unit])
        if out.strip() == "active":
            return True
        if out.strip() in {"inactive", "failed", "deactivating", "activating"}:
            saw = True
    return False if saw else None


def port_open(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.4):
            return True
    except OSError:
        return False


def service_entry(sid: str, scope: str, ok: bool | None, latency_ms: int | None = None, extra: dict | None = None) -> dict:
    if ok is True:
        status = "live"
    elif ok is False:
        status = "down"
    else:
        status = "standby"
    item = {"id": sid, "status": status, "scope": scope}
    if latency_ms is not None:
        item["latency_ms"] = latency_ms
    if extra:
        item["detail"] = extra
    return item


def snapshot() -> dict:
    t0 = time.perf_counter()
    core = host_metrics()
    services: dict[str, dict] = {}

    running = docker_names()
    with ThreadPoolExecutor(max_workers=8) as pool:
        futs = {pool.submit(http_probe, url): (sid, scope) for sid, url, scope in HTTP_CHECKS}
        http_results = {}
        for fut in as_completed(futs):
            sid, scope = futs[fut]
            try:
                http_results[sid] = (scope, fut.result())
            except Exception:
                http_results[sid] = (scope, {"ok": False, "code": 0, "latency_ms": 0})

    for sid, (scope, res) in http_results.items():
        extra = None
        body = res.get("json") if isinstance(res.get("json"), dict) else None
        if sid == "docs-agent" and body:
            extra = {}
            if "indexDocs" in body:
                extra["indexDocs"] = body["indexDocs"]
            if "ok" in body:
                extra["ok"] = bool(body["ok"])
            if not extra:
                extra = None
        docker_ok = docker_running(CONTAINER_ALIASES.get(sid, ()), running)
        ok = bool(res.get("ok"))
        if docker_ok is False and not ok:
            ok = False
        elif docker_ok is True or ok:
            ok = True
        services[sid] = service_entry(sid, scope, ok, res.get("latency_ms"), extra)

    ingress = unit_active(UNITS["ingress"])
    if ingress is None:
        ingress = port_open(443)
    services["ingress"] = service_entry("ingress", "core", True if ingress else False)

    mesh = unit_active(UNITS["mesh-node"])
    if mesh is None:
        mesh = port_open(2096) or port_open(2053)
    services["mesh-node"] = service_entry("mesh-node", "private", mesh if mesh is not None else None)

    mail = unit_active(UNITS["mail"])
    if mail is not True:
        mail = any(port_open(p) for p in MAIL_PORTS)
    services["mail"] = service_entry("mail", "private", True if mail else False)

    services["apac"] = service_entry("apac", "planned", None)

    live_public = sum(1 for s in services.values() if s["scope"] == "public" and s["status"] == "live")
    payload = {
        "ok": True,
        "ts": int(time.time()),
        "probe_ms": int((time.perf_counter() - t0) * 1000),
        "core": core,
        "mesh": {
            "core": "live",
            "apac": "standby",
        },
        "services": services,
        "summary": {
            "public_live": live_public,
            "public_total": sum(1 for s in services.values() if s["scope"] == "public"),
        },
    }
    return payload


def cached_snapshot() -> dict:
    now = time.monotonic()
    with _lock:
        if _cache["payload"] and now - _cache["ts"] < CACHE_TTL:
            return _cache["payload"]
    payload = snapshot()
    with _lock:
        _cache["ts"] = time.monotonic()
        _cache["payload"] = payload
    return payload


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def end_headers(self) -> None:
        if self.path.split("?", 1)[0] == "/api/status":
            self.send_header("Cache-Control", "no-store")
        else:
            self.send_header("Cache-Control", "public, max-age=60")
        super().end_headers()

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == "/api/status":
            body = json.dumps(cached_snapshot(), separators=(",", ":")).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        rel = path.lstrip("/") or "index.html"
        suffix = Path(rel).suffix.lower()
        if suffix in DENY_SUFFIXES:
            self.send_error(404, "Not found")
            return
        super().do_GET()


def main() -> int:
    parser = argparse.ArgumentParser(description="nvc.ac site + probe")
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "4173")))
    args = parser.parse_args()
    httpd = ThreadingHTTPServer((args.bind, args.port), Handler)
    print(f"nvc.ac listening on http://{args.bind}:{args.port}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
