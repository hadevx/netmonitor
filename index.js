const http = require("http");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// --- Real throughput from /proc/net/dev ---

let lastNetStats = null;
let bytesInPerSec = 0;
let bytesOutPerSec = 0;
const throughputHistory = Array(30).fill({ in: 0, out: 0 });

function readProcNetDev() {
  try {
    const raw = fs.readFileSync("/proc/net/dev", "utf8");
    const lines = raw.trim().split("\n").slice(2); // skip header lines
    const result = {};
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const iface = parts[0].replace(":", "");
      result[iface] = {
        bytesIn: parseInt(parts[1], 10),
        bytesOut: parseInt(parts[9], 10),
      };
    }
    return result;
  } catch (e) {
    return null;
  }
}

function updateThroughput() {
  const current = readProcNetDev();
  if (!current) return;

  if (lastNetStats) {
    let totalIn = 0;
    let totalOut = 0;
    for (const iface of Object.keys(current)) {
      if (iface === "lo") continue; // skip loopback
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
updateThroughput(); // seed initial snapshot

// --- Real active connections from `ss` ---

function getActiveConnections() {
  try {
    // -t = TCP, -u = UDP, -n = numeric, -p = process, -a = all
    const output = execSync("ss -tuna", { timeout: 3000 }).toString();
    const lines = output.trim().split("\n").slice(1); // skip header
    const connections = [];

    const knownPorts = {
      443: "HTTPS",
      80: "HTTP",
      22: "SSH",
      27017: "MongoDB",
      5432: "PostgreSQL",
      3306: "MySQL",
      3000: "Node Dev",
      8080: "Alt HTTP",
      53: "DNS",
      6379: "Redis",
      8443: "HTTPS Alt",
      4001: "Node API",
      25: "SMTP",
      587: "SMTP",
      993: "IMAPS",
    };

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5) continue;

      const proto = parts[0]; // tcp / udp
      const state = parts[1]; // ESTABLISHED, LISTEN, etc.
      const localFull = parts[4];
      const remoteFull = parts[5];

      if (!localFull || !remoteFull) continue;

      // parse address:port (handles IPv6 too)
      const parseAddr = (addr) => {
        const lastColon = addr.lastIndexOf(":");
        return {
          address: addr.substring(0, lastColon),
          port: parseInt(addr.substring(lastColon + 1), 10) || 0,
        };
      };

      const local = parseAddr(localFull);
      const remote = parseAddr(remoteFull);

      const service =
        knownPorts[local.port] ||
        knownPorts[remote.port] ||
        (local.port ? `port ${local.port}` : "unknown");

      connections.push({
        protocol: proto.toUpperCase(),
        state: state === "ESTAB" ? "ESTABLISHED" : state || "STATELESS",
        localAddress: local.address,
        localPort: local.port,
        remoteAddress: remote.address,
        remotePort: remote.port,
        service,
      });
    }

    return connections;
  } catch (e) {
    return [];
  }
}

// --- Real network interface info ---

function getNetworkStats() {
  const interfaces = os.networkInterfaces();
  const result = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
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

// --- Real system info ---

function getSystemInfo() {
  const cpus = os.cpus();

  // CPU usage via /proc/stat
  let cpuUsage = 0;
  try {
    const stat1 = fs
      .readFileSync("/proc/stat", "utf8")
      .split("\n")[0]
      .split(/\s+/)
      .slice(1)
      .map(Number);
    const idle1 = stat1[3];
    const total1 = stat1.reduce((a, b) => a + b, 0);
    // small blocking wait for delta
    execSync("sleep 0.1");
    const stat2 = fs
      .readFileSync("/proc/stat", "utf8")
      .split("\n")[0]
      .split(/\s+/)
      .slice(1)
      .map(Number);
    const idle2 = stat2[3];
    const total2 = stat2.reduce((a, b) => a + b, 0);
    cpuUsage = Math.round(100 * (1 - (idle2 - idle1) / (total2 - total1)));
  } catch (_) {}

  // Uptime
  let uptime = os.uptime();

  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    totalMem: os.totalmem(),
    freeMem: os.freemem(),
    uptime,
    cpuModel: cpus[0]?.model || "Unknown",
    cpuCores: cpus.length,
    cpuUsage,
  };
}

// --- SSE clients ---

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
    interfaces: getNetworkStats(),
    connections: getActiveConnections(),
    throughput: { in: bytesInPerSec, out: bytesOutPerSec, history: throughputHistory },
    timestamp: Date.now(),
  });
}, 1000);

// --- HTTP server ---

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
server.listen(PORT, () => {
  console.log(`\n  Network Dashboard running at http://localhost:${PORT}\n`);
});
