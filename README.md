# 🖥️ VPS Monitor

A lightweight, real-time server monitoring dashboard built with **pure Node.js** — no framework, no dependencies. Displays live system stats streamed directly from your Linux VPS to the browser via Server-Sent Events (SSE).

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat&logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat)
![Zero Dependencies](https://img.shields.io/badge/dependencies-zero-brightgreen?style=flat)

---

## ✨ Features

- 📡 **Real-time streaming** — live updates every second via SSE, no polling
- 📊 **Network throughput** — real inbound/outbound bytes/sec from `/proc/net/dev` with a 60-second history chart
- 🧠 **CPU usage** — total usage + per-core breakdown from `/proc/stat`
- 💾 **Memory** — total, used, free, and pressure bar
- ⚖️ **Load average** — 1m / 5m / 15m with relative-to-cores visualization
- 💿 **Disk usage** — all mounted volumes with used/total/percent bars
- 🔗 **Active connections** — real TCP/UDP sockets from `ss -tuna`
- 🔓 **Open ports** — all listening ports with service names and processes
- 🐳 **Docker containers** — name, image, running/stopped status, exposed ports
- 🌐 **Network interfaces** — all interfaces with IPs, families, and MAC addresses
- 📋 **Top processes** — top 10 by CPU usage via `ps aux`
- ⏱️ **Uptime** — formatted days/hours/minutes
- 🐧 **Distro detection** — reads `/etc/os-release` for the actual distro name

---

## 🚀 Getting Started

### Prerequisites

- Node.js v18+
- Linux VPS (uses `/proc` filesystem and Linux tools)
- `ss` and `ps` available (standard on all Linux distros)
- `docker` installed (optional — Docker panel shows "no containers" if absent)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/vps-monitor.git
cd vps-monitor

# No dependencies to install — runs on Node.js built-ins only
node index.js
```

### Run with Auto-restart

```bash
# Using nodemon (dev)
npx nodemon index.js

# Using PM2 (production)
pm2 start index.js --name vps-monitor
pm2 save
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port the server listens on |

```bash
PORT=4000 node index.js
```

---

## 📁 Project Structure

```
├── index.js        # Server — data collection + SSE broadcast
├── index.html      # Frontend — dashboard UI (vanilla JS + Canvas)
└── package.json
```

No build step. No bundler. No node_modules needed.

---

## 🔬 How It Works

### Backend (`index.js`)

All data is collected server-side on a 1-second interval and broadcast to connected browsers via SSE:

| Data | Source |
|---|---|
| Network throughput | `/proc/net/dev` — byte counter diff per second |
| CPU usage (total + per core) | `/proc/stat` — idle/total tick diff |
| Memory | `os.freemem()` / `os.totalmem()` |
| Load average | `/proc/loadavg` |
| Disk usage | `df -BM` |
| Active connections | `ss -tuna` |
| Open ports | `ss -tlnup` |
| Top processes | `ps aux --sort=-%cpu` |
| Docker containers | `docker ps -a` |
| Network interfaces | `os.networkInterfaces()` |
| Distro | `/etc/os-release` |
| Uptime | `os.uptime()` |

### Frontend (`index.html`)

Pure vanilla JavaScript. No libraries. Connects to `/events` as an SSE stream and updates the DOM on every tick. The throughput chart is drawn on an HTML5 `<canvas>` element.

### Data Flow

```
Linux kernel / system tools
        │
        ▼
index.js (Node.js — reads /proc, runs ss/ps/df/docker)
        │
        ▼  Server-Sent Events (text/event-stream)
        │
        ▼
Browser (index.html — renders live dashboard)
```

---

## 📡 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Serves the dashboard HTML |
| `GET` | `/events` | SSE stream — pushes JSON data every second |

### SSE Payload Shape

```json
{
  "type": "tick",
  "timestamp": 1716000000000,
  "system": {
    "hostname": "my-vps",
    "distro": "Ubuntu 22.04.3 LTS",
    "platform": "linux",
    "arch": "x64",
    "cpuModel": "Intel Xeon E5-2670",
    "cpuCores": 4,
    "cpuUsage": 12,
    "cpuPerCore": [10, 8, 15, 14],
    "totalMem": 4294967296,
    "freeMem": 2147483648,
    "uptime": "2d 4h 30m",
    "load": { "load1": 0.45, "load5": 0.38, "load15": 0.31 }
  },
  "throughput": {
    "in": 15200,
    "out": 4800,
    "history": [{ "in": 0, "out": 0 }]
  },
  "disk": [
    { "mount": "/", "size": 51200, "used": 20480, "avail": 30720, "pct": 40, "fstype": "ext4" }
  ],
  "processes": [
    { "pid": "1234", "user": "root", "cpu": 2.1, "mem": 0.8, "command": "node index.js" }
  ],
  "connections": [
    { "protocol": "TCP", "state": "ESTABLISHED", "localAddress": "10.0.0.1", "localPort": 3000, "remoteAddress": "1.2.3.4", "remotePort": 443, "service": "HTTPS" }
  ],
  "ports": [
    { "port": 22, "proto": "TCP", "name": "SSH", "process": "sshd" }
  ],
  "interfaces": [
    { "name": "eth0", "family": "IPv4", "address": "10.0.0.1", "internal": false }
  ],
  "docker": [
    { "name": "my-app", "image": "node:18", "status": "Up 2 hours", "running": true, "ports": "0.0.0.0:4001->4001/tcp" }
  ]
}
```

---

## 🖼️ Dashboard Panels

| Panel | Description |
|---|---|
| Stat strip | Inbound, Outbound, CPU%, Free Memory, Load 1m, Uptime |
| Network Throughput | 60s history chart (inbound + outbound) |
| CPU Per Core | Per-core usage bars with color thresholds |
| System Info | Hostname, distro, platform, arch, cores, uptime |
| Load Average | 1m / 5m / 15m with relative bar |
| Memory | Total / free / used with pressure bar |
| Disk Usage | All mounted volumes with usage bars |
| Top Processes | Top 10 by CPU — PID, user, CPU%, MEM%, command |
| Active Connections | Real TCP/UDP connections with states |
| Open Ports | Listening ports with service and process |
| Network Interfaces | All interfaces with IP, family, MAC |
| Docker Containers | Container status, image, and ports |

---

## ⚙️ Deployment on Coolify

1. Push the repo to GitHub
2. In Coolify → **New Resource → Application → GitHub**
3. Set **Start Command**: `node index.js`
4. Set **Port**: `3000`
5. Add environment variable: `PORT=3000`
6. Deploy

> **Note**: The Docker panel requires the Coolify host's Docker socket to be accessible inside the container, which may need additional configuration depending on your setup.

---

## 🔒 Security Note

This dashboard exposes real server internals (processes, open ports, connections). It is recommended to:
- Run it behind a reverse proxy with HTTP Basic Auth
- Restrict access by IP in your firewall
- Do **not** expose it publicly without authentication

---

## 📄 License

This project is licensed under the MIT License.
