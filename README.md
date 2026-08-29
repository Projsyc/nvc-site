# NVC.AC · Orbital Mesh

Visual home for `nvc.ac`. Copy is native English. Public topology and services only — no IPs, ports, keys, subscriptions, or panel paths.

Status pills, the HUD, and the telemetry console read `/api/status`. The core probe reports real CPU utilization, memory pressure, root-volume usage, uptime/load, and kernel-exposed thermal sensors alongside loopback HTTP, Docker, and systemd checks.

Temperature is intentionally shown as unavailable when the VPS hypervisor does not expose a thermal sensor; the site never substitutes an estimated or demo value.

## Local preview

```bash
cd ~/vps-deploy/site
python3 server.py --bind 127.0.0.1 --port 4173
# http://127.0.0.1:4173
# http://127.0.0.1:4173/api/status
```

On the laptop, most core checks will show DOWN (those processes live on the VPS). `aipm.ac` may still show LIVE because it is a public HTTPS probe.

## Production

On the Los Angeles core the files live at `/opt/nvc-site`, supervised by `nvc-site.service` (`deploy/site/nvc-site.service`). Cloudflare tunnel: `nvc.ac` → `http://127.0.0.1:4173`.

From this repo:

```bash
./deploy/site/setup.sh
```
