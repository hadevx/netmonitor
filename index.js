const http = require("http");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { execSync, exec } = require("child_process");

// ── helpers ──────────────────────────────────────────────────────────────────

function run(cmd) {
  try {
    return execSync(cmd, { timeout: 4000 }).toString().trim();
  } catch (_) {
    return "";
  }
}

// ── throughput (/proc/net/dev) ────────────────────────────────────────────────

let lastNetStats = null;
let bytesInPerSec = 0;
let bytesOutPerSec = 0;
const throughputHistory = Array(60).fill({ in: 0, out: 0 });

function readProcNetDev() {
  try {
    const lines = fs.readFileSync("/proc/net/dev", "utf8").trim().split("\n").slice(2);
    const result = {};
    for (const line of lines) {
      const p = line.trim().split(/\s+/);
      const iface = p[0].replace(":", "");
      result[iface] = { bytesIn: parseInt(p[1], 10), bytesOut: parseInt(p[9], 10) };
    }
    return result;
  } catch (_) {
    return null;
  }
}

function updateThroughput() {
  const current = readProcNetDev();
  if (!current) return;
  if (lastNetStats) {
    let totalIn = 0,
      totalOut = 0;
    for (const iface of Object.keys(current)) {
      if (iface === "lo") continue;
      const prev = lastNetStats[iface];
      if (!prev) continue;
      totalIn += Math.max(0, current[iface].bytesIn - prev.bytesIn);
      totalOut += Math.max(0, current[iface].bytesOut - prev.bytesOut);
    }
    bytesInPerSec = totalIn;
    bytesOutPerSec = totalOut;
    throughputHistory.shift();
    throughputHistory.push({ in: totalIn, out: totalOut });
  }
  lastNetStats = current;
}

setInterval(updateThroughput, 1000);
updateThroughput();

// ── CPU usage (/proc/stat) ────────────────────────────────────────────────────

let lastCpuStats = null;
let cpuUsageTotal = 0;
let cpuPerCore = [];

function readProcStat() {
  try {
    const lines = fs.readFileSync("/proc/stat", "utf8").split("\n");
    const result = [];
    for (const line of lines) {
      if (!line.startsWith("cpu")) break;
      const parts = line.split(/\s+/).slice(1).map(Number);
      const idle = parts[3] + (parts[4] || 0);
      const total = parts.reduce((a, b) => a + b, 0);
      result.push({ idle, total });
    }
    return result;
  } catch (_) {
    return null;
  }
}

function updateCpuUsage() {
  const current = readProcStat();
  if (!current || !lastCpuStats) {
    lastCpuStats = current;
    return;
  }
  const results = [];
  for (let i = 0; i < current.length; i++) {
    const prev = lastCpuStats[i];
    if (!prev) continue;
    const diffIdle = current[i].idle - prev.idle;
    const diffTotal = current[i].total - prev.total;
    const usage = diffTotal === 0 ? 0 : Math.round(100 * (1 - diffIdle / diffTotal));
    results.push(Math.max(0, Math.min(100, usage)));
  }
  cpuUsageTotal = results[0] ?? 0;
  cpuPerCore = results.slice(1);
  lastCpuStats = current;
}

setInterval(updateCpuUsage, 1000);
lastCpuStats = readProcStat();

// ── active connections (ss) ───────────────────────────────────────────────────

const PORT_NAMES = {
  21: "FTP",
  22: "SSH",
  23: "Telnet",
  25: "SMTP",
  53: "DNS",
  80: "HTTP",
  110: "POP3",
  143: "IMAP",
  443: "HTTPS",
  587: "SMTP",
  993: "IMAPS",
  3000: "Node Dev",
  3306: "MySQL",
  4001: "Node API",
  5432: "PostgreSQL",
  6379: "Redis",
  8080: "Alt HTTP",
  8443: "HTTPS Alt",
  27017: "MongoDB",
};

function getActiveConnections() {
  const output = run("ss -tuna");
  if (!output) return [];
  const lines = output.split("\n").slice(1);
  const conns = [];
  for (const line of lines) {
    const p = line.trim().split(/\s+/);
    if (p.length < 5) continue;
    const proto = p[0],
      state = p[1];
    const localFull = p[4],
      remoteFull = p[5];
    if (!localFull || !remoteFull) continue;
    const parse = (addr) => {
      const i = addr.lastIndexOf(":");
      return { address: addr.slice(0, i), port: parseInt(addr.slice(i + 1), 10) || 0 };
    };
    const local = parse(localFull);
    const remote = parse(remoteFull);
    const svc = PORT_NAMES[local.port] || PORT_NAMES[remote.port] || `port ${local.port}`;
    const st = state === "ESTAB" ? "ESTABLISHED" : state || "STATELESS";
    conns.push({
      protocol: proto.toUpperCase(),
      state: st,
      localAddress: local.address,
      localPort: local.port,
      remoteAddress: remote.address,
      remotePort: remote.port,
      service: svc,
    });
  }
  return conns;
}

// ── disk usage (df) ───────────────────────────────────────────────────────────

function getDiskUsage() {
  const output = run(
    "df -BM --output=source,fstype,size,used,avail,pcent,target -x tmpfs -x devtmpfs -x overlay -x squashfs",
  );
  if (!output) return [];
  const lines = output.split("\n").slice(1);
  const disks = [];
  for (const line of lines) {
    const p = line.trim().split(/\s+/);
    if (p.length < 7) continue;
    disks.push({
      source: p[0],
      fstype: p[1],
      size: parseInt(p[2], 10),
      used: parseInt(p[3], 10),
      avail: parseInt(p[4], 10),
      pct: parseInt(p[5], 10),
      mount: p[6],
    });
  }
  return disks;
}

// ── top processes (ps) ────────────────────────────────────────────────────────

function getTopProcesses() {
  const output = run("ps aux --sort=-%cpu --no-headers");
  if (!output) return [];
  return output
    .split("\n")
    .slice(0, 10)
    .map((line) => {
      const p = line.trim().split(/\s+/);
      return {
        user: p[0],
        pid: p[1],
        cpu: parseFloat(p[2]),
        mem: parseFloat(p[3]),
        command: p.slice(10).join(" ").slice(0, 60),
      };
    })
    .filter((p) => p.pid);
}

// ── load average (/proc/loadavg) ──────────────────────────────────────────────

function getLoadAverage() {
  try {
    const raw = fs.readFileSync("/proc/loadavg", "utf8").split(" ");
    return { load1: parseFloat(raw[0]), load5: parseFloat(raw[1]), load15: parseFloat(raw[2]) };
  } catch (_) {
    const avg = os.loadavg();
    return { load1: avg[0], load5: avg[1], load15: avg[2] };
  }
}

// ── uptime ────────────────────────────────────────────────────────────────────

function getUptimeFormatted() {
  const s = Math.floor(os.uptime());
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

// ── open ports (ss -tlnup) ────────────────────────────────────────────────────

function getOpenPorts() {
  const output = run("ss -tlnup");
  if (!output) return [];
  const lines = output.split("\n").slice(1);
  const ports = [];
  const seen = new Set();
  for (const line of lines) {
    const p = line.trim().split(/\s+/);
    if (p.length < 5) continue;
    const localFull = p[3];
    const i = localFull.lastIndexOf(":");
    const port = parseInt(localFull.slice(i + 1), 10);
    if (!port || seen.has(port)) continue;
    seen.add(port);
    const proc = line.includes("users:") ? line.replace(/.*users:\(\("([^"]+)".*/, "$1") : "—";
    ports.push({ port, name: PORT_NAMES[port] || "—", proto: p[0].toUpperCase(), process: proc });
  }
  return ports.sort((a, b) => a.port - b.port);
}

// ── docker containers ─────────────────────────────────────────────────────────

function getDockerContainers() {
  const output = run(
    `docker ps -a --format "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"`,
  );
  if (!output) return [];
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [id, name, image, status, ports] = line.split("\t");
      const running = status && status.toLowerCase().startsWith("up");
      return { id: id?.slice(0, 12), name, image, status, ports: ports || "—", running };
    });
}

// ── distro ────────────────────────────────────────────────────────────────────

function getDistro() {
  try {
    const raw = fs.readFileSync("/etc/os-release", "utf8");
    const m = raw.match(/^PRETTY_NAME="(.+)"/m);
    return m ? m[1] : os.platform();
  } catch (_) {
    return os.platform();
  }
}

// ── network interfaces ────────────────────────────────────────────────────────

function getNetworkInterfaces() {
  const ifaces = os.networkInterfaces();
  const result = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const addr of addrs) {
      result.push({
        name,
        family: addr.family,
        address: addr.address,
        netmask: addr.netmask,
        mac: addr.mac,
        internal: addr.internal,
        cidr: addr.cidr,
      });
    }
  }
  return result;
}

// ── system info ───────────────────────────────────────────────────────────────

function getSystemInfo() {
  const cpus = os.cpus();
  return {
    hostname: os.hostname(),
    distro: getDistro(),
    platform: os.platform(),
    arch: os.arch(),
    totalMem: os.totalmem(),
    freeMem: os.freemem(),
    uptime: getUptimeFormatted(),
    cpuModel: cpus[0]?.model || "Unknown",
    cpuCores: cpus.length,
    cpuUsage: cpuUsageTotal,
    cpuPerCore,
    load: getLoadAverage(),
  };
}

// ── SSE broadcast ─────────────────────────────────────────────────────────────

const clients = new Set();

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(msg);
    } catch (_) {
      clients.delete(res);
    }
  }
}

setInterval(() => {
  broadcast({
    type: "tick",
    system: getSystemInfo(),
    interfaces: getNetworkInterfaces(),
    connections: getActiveConnections(),
    throughput: { in: bytesInPerSec, out: bytesOutPerSec, history: throughputHistory },
    disk: getDiskUsage(),
    processes: getTopProcesses(),
    ports: getOpenPorts(),
    docker: getDockerContainers(),
    timestamp: Date.now(),
  });
}, 1000);

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.url === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(":\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (req.url === "/" || req.url === "/index.html") {
    const html = fs.readFileSync(path.join(__dirname, "index.html"));
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`\n  VPS Monitor running at http://localhost:${PORT}\n`));
