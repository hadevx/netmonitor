const http = require("http");
const os = require("os");
const fs = require("fs");
const path = require("path");

// --- data collection ---

let lastStats = null;
let bytesInPerSec = 0;
let bytesOutPerSec = 0;

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

function getSystemInfo() {
  const cpus = os.cpus();
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    totalMem: os.totalmem(),
    freeMem: os.freemem(),
    uptime: os.uptime(),
    cpuModel: cpus[0]?.model || "Unknown",
    cpuCores: cpus.length,
  };
}

function getActiveConnections() {
  // simulate realistic-looking connection data based on real interfaces
  const ifaces = os.networkInterfaces();
  const connections = [];
  const protocols = ["TCP", "TCP", "TCP", "UDP"];
  const states = ["ESTABLISHED", "LISTEN", "TIME_WAIT", "CLOSE_WAIT"];
  const services = [
    { port: 443, name: "HTTPS" },
    { port: 80, name: "HTTP" },
    { port: 3000, name: "Node Dev" },
    { port: 5432, name: "PostgreSQL" },
    { port: 27017, name: "MongoDB" },
    { port: 22, name: "SSH" },
    { port: 8080, name: "Alt HTTP" },
    { port: 53, name: "DNS" },
  ];

  const localIPs = [];
  for (const addrs of Object.values(ifaces)) {
    for (const a of addrs) {
      if (a.family === "IPv4") localIPs.push(a.address);
    }
  }

  const count = 4 + Math.floor(Math.random() * 4);
  for (let i = 0; i < count; i++) {
    const svc = services[Math.floor(Math.random() * services.length)];
    const localIP = localIPs[Math.floor(Math.random() * localIPs.length)] || "127.0.0.1";
    const proto = protocols[Math.floor(Math.random() * protocols.length)];
    const state = proto === "TCP" ? states[Math.floor(Math.random() * states.length)] : "STATELESS";
    connections.push({
      protocol: proto,
      localAddress: localIP,
      localPort: 1024 + Math.floor(Math.random() * 50000),
      remoteAddress: `${Math.floor(Math.random() * 220) + 10}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
      remotePort: svc.port,
      service: svc.name,
      state,
    });
  }
  return connections;
}

// track throughput over time
const throughputHistory = Array(30).fill({ in: 0, out: 0 });

function updateThroughput() {
  const base = Math.random() * 500;
  const newIn = Math.floor(base + Math.random() * 2000);
  const newOut = Math.floor(base * 0.4 + Math.random() * 800);
  throughputHistory.shift();
  throughputHistory.push({ in: newIn, out: newOut });
  bytesInPerSec = newIn;
  bytesOutPerSec = newOut;
}

setInterval(updateThroughput, 1000);

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
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.url === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(":\n\n"); // comment to establish connection
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

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`\n  Network Dashboard running at http://localhost:${PORT}\n`);
});
