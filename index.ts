import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import path from "node:path";
import * as db from "./MongoDB";

const PORT = Number(process.env.PORT || 3000);
const MONGO_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/smartac";
const LED_WATT = Number(process.env.LED_WATT || 10);
const SIM_TICK_MS = Number(process.env.SIM_TICK_MS || 30000);

const DRAW: Record<string, number> = { cool: 700, dry: 300, fan: 60 };
const MODES = ["cool", "dry", "fan"];
const FANS = ["auto", "low", "high"];

const app = express();
const http = createServer(app);
const io = new Server(http);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const todayStr = () => new Date().toISOString().slice(0, 10);
const dateStr = (offsetDays: number) => new Date(Date.now() - offsetDays * 86400000).toISOString().slice(0, 10);

app.get("/api/config", (_req, res) => {
  res.json({ server: true });
});

app.get("/api/devices", async (_req, res) => {
  res.json(await db.listDevices());
});

app.post("/api/devices/register", async (req, res) => {
  const b: any = req.body || {};
  if (!b.name) {
    res.status(400).json({ error: "name wajib" });
    return;
  }
  const d = await db.createDevice({
    name: String(b.name),
    brand: String(b.brand || "Umum"),
    room: String(b.room || "-"),
    ip: String(b.ip || ""),
    ssid: String(b.ssid || ""),
    online: true,
    power: false,
    mode: "cool",
    temp: 24,
    fan: "auto",
    roomTemp: 28,
    humidity: 60
  });
  io.emit("state", d);
  res.json(d);
});

app.delete("/api/devices/:id", async (req, res) => {
  const ok = await db.deleteDevice(req.params.id);
  if (!ok) {
    res.status(404).json({ error: "device tidak ditemukan" });
    return;
  }
  io.emit("device:deleted", { id: req.params.id });
  res.json({ ok: true });
});

app.post("/api/devices/:id/command", async (req, res) => {
  const b: any = req.body || {};
  const patch: any = {};
  if (typeof b.power === "boolean") patch.power = b.power;
  if (typeof b.temp === "number") patch.temp = Math.min(30, Math.max(16, Math.round(b.temp)));
  if (typeof b.mode === "string" && MODES.includes(b.mode)) patch.mode = b.mode;
  if (typeof b.fan === "string" && FANS.includes(b.fan)) patch.fan = b.fan;
  const d = await db.patchDevice(req.params.id, patch);
  if (!d) {
    res.status(404).json({ error: "device tidak ditemukan" });
    return;
  }
  await db.logCommand(d._id, b);
  io.emit("state", d);
  res.json(d);
});

app.get("/api/devices/:id/usage", async (req, res) => {
  const date = String((req as any).query.date || todayStr());
  const hours = await db.getUsage(req.params.id, date);
  res.json({ date, hours });
});

app.get("/api/devices/:id/summary", async (req, res) => {
  const d = await db.getDeviceById(req.params.id);
  if (!d) {
    res.status(404).json({ error: "device tidak ditemukan" });
    return;
  }
  const hours = await db.getUsage(d._id, todayStr());
  const wh = hours.reduce((a, b) => a + b, 0);
  const draw = DRAW[d.mode] || 700;
  res.json({ wh, kwh: +(wh / 1000).toFixed(2), ledHours: +(wh / LED_WATT).toFixed(1), onHours: +(wh / draw).toFixed(1) });
});

io.on("connection", (socket) => {
  socket.on("device:register", async (msg: any) => {
    if (msg && msg.id) {
      const d = await db.patchDevice(msg.id, { online: true });
      if (d) io.emit("state", d);
      return;
    }
    if (msg && msg.name) {
      const d = await db.createDevice({
        name: String(msg.name),
        brand: String(msg.brand || "Umum"),
        room: String(msg.room || "-"),
        ip: String(msg.ip || ""),
        ssid: String(msg.ssid || ""),
        online: true,
        power: false,
        mode: "cool",
        temp: 24,
        fan: "auto",
        roomTemp: 28,
        humidity: 60
      });
      io.emit("state", d);
    }
  });
  socket.on("device:telemetry", async (msg: any) => {
    const patch: any = {};
    if (msg && typeof msg.roomTemp === "number") patch.roomTemp = msg.roomTemp;
    if (msg && typeof msg.humidity === "number") patch.humidity = msg.humidity;
    const d = msg && msg.id ? await db.patchDevice(msg.id, patch) : null;
    if (d) io.emit("state", d);
  });
});

async function seed() {
  if (await db.isSeeded()) return;
  const created = await db.createDevices([
    { name: "AC Ruang Keluarga", brand: "Hisense", room: "Ruang Keluarga", ip: "192.168.1.21", ssid: "Keluarga-5G", online: true, power: true, mode: "cool", temp: 24, fan: "auto", roomTemp: 26.8, humidity: 61 },
    { name: "AC Kamar Nathan", brand: "Hisense", room: "Kamar Nathan", ip: "192.168.1.22", ssid: "Keluarga-5G", online: true, power: false, mode: "cool", temp: 25, fan: "low", roomTemp: 29.1, humidity: 58 },
    { name: "AC Kamar Toby", brand: "Sharp", room: "Kamar Toby", ip: "192.168.1.23", ssid: "Keluarga-5G", online: false, power: false, mode: "fan", temp: 26, fan: "high", roomTemp: 30.4, humidity: 64 }
  ]);
  const hour = new Date().getHours();
  const pattern = [0, 0, 0, 0, 0, 0, 12, 28, 42, 36, 18, 8, 0, 0, 0, 6, 18, 38, 55, 60, 44, 26, 12, 4];
  for (const d of created) {
    await db.createUsage(d._id, dateStr(1), pattern.map((v) => Math.round(v * (0.6 + Math.random() * 0.8))));
    const todayHours = Array(24).fill(0);
if (d.power) for (let h = 0; h < hour; h++) todayHours[h] = Math.round((pattern[h] ?? 0) * (0.5 + Math.random() * 0.6));
    await db.createUsage(d._id, todayStr(), todayHours);
  }
  await db.markSeeded();
}

async function simulateTick() {
  const { devices } = await db.listDevices();
  const date = todayStr();
  const hour = new Date().getHours();
  const minutes = SIM_TICK_MS / 60000;
  const states: db.DeviceState[] = [];
  for (const d of devices) {
    const patch: any = {};
    if (d.power && d.online) patch.roomTemp = Math.max(21, +(d.roomTemp - 0.04).toFixed(1));
    else patch.roomTemp = Math.min(32, +(d.roomTemp + 0.06).toFixed(1));
    patch.humidity = Math.max(40, Math.min(75, +(d.humidity + (d.power ? -0.1 : 0.15)).toFixed(1)));
    const updated = await db.patchDevice(d._id, patch);
    if (updated) {
      states.push(updated);
      if (updated.power && updated.online) {
        const wh = +(((DRAW[updated.mode] || 700) * minutes) / 60).toFixed(2);
        await db.addUsageWh(updated._id, date, hour, wh);
      }
    }
  }
  io.emit("telemetry", { devices: states });
}

async function main() {
  await db.connectDb(MONGO_URI);
  await seed();
  setInterval(simulateTick, SIM_TICK_MS);
  http.listen(PORT, () => {
    console.log(`SmartAC demo jalan di http://localhost:${PORT}`);
  });
}

main();
