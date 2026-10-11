import mongoose from "mongoose";

export interface DeviceState {
  _id: string;
  name: string;
  brand: string;
  room: string;
  ip: string;
  ssid: string;
  online: boolean;
  power: boolean;
  mode: string;
  temp: number;
  fan: string;
  roomTemp: number;
  humidity: number;
}

const deviceSchema = new mongoose.Schema(
  {
    name: String,
    brand: String,
    room: String,
    ip: String,
    ssid: String,
    online: Boolean,
    power: Boolean,
    mode: { type: String, default: "cool" },
    temp: { type: Number, default: 24 },
    fan: { type: String, default: "auto" },
    roomTemp: { type: Number, default: 28 },
    humidity: { type: Number, default: 60 }
  },
  { timestamps: true }
);
const Device = mongoose.model("Device", deviceSchema);

const usageSchema = new mongoose.Schema(
  {
    device: { type: mongoose.Schema.Types.ObjectId, index: true },
    date: String,
    hours: { type: [Number], default: () => Array(24).fill(0) }
  },
  { timestamps: true }
);
usageSchema.index({ device: 1, date: 1 }, { unique: true });
const Usage = mongoose.model("Usage", usageSchema);

const commandSchema = new mongoose.Schema({ device: String, body: Object }, { timestamps: true });
const Command = mongoose.model("Command", commandSchema);

const settingSchema = new mongoose.Schema({ key: { type: String, index: true }, value: Object }, { timestamps: true });
const Setting = mongoose.model("Setting", settingSchema);

const pub = (d: any): DeviceState => ({
  _id: String(d._id),
  name: d.name,
  brand: d.brand,
  room: d.room,
  ip: d.ip,
  ssid: d.ssid,
  online: d.online,
  power: d.power,
  mode: d.mode,
  temp: d.temp,
  fan: d.fan,
  roomTemp: d.roomTemp,
  humidity: d.humidity
});

export async function connectDb(uri: string): Promise<void> {
  await mongoose.connect(uri);
}

export async function listDevices(): Promise<{ ssid: string; devices: DeviceState[] }> {
  const docs = await Device.find().sort({ name: 1 });
  return { ssid: docs[0]?.ssid || "Rumah", devices: docs.map(pub) };
}

export async function getDeviceById(id: string): Promise<DeviceState | null> {
  if (!mongoose.isValidObjectId(id)) return null;
  const doc = await Device.findById(id);
  return doc ? pub(doc) : null;
}

export async function patchDevice(
  id: string,
  patch: Partial<Pick<DeviceState, "power" | "temp" | "mode" | "fan" | "roomTemp" | "humidity" | "online">>
): Promise<DeviceState | null> {
  if (!mongoose.isValidObjectId(id)) return null;
  const doc = await Device.findByIdAndUpdate(id, { $set: patch }, { new: true });
  return doc ? pub(doc) : null;
}

export async function logCommand(deviceId: string, body: Record<string, unknown>): Promise<void> {
  await Command.create({ device: deviceId, body });
}

export async function getUsage(deviceId: string, date: string): Promise<number[]> {
  let doc = await Usage.findOne({ device: deviceId, date });
  if (!doc) doc = await Usage.create({ device: deviceId, date, hours: Array(24).fill(0) });
  return doc.hours as number[];
}

export async function addUsageWh(deviceId: string, date: string, hour: number, wh: number): Promise<void> {
  await Usage.updateOne({ device: deviceId, date }, { $setOnInsert: { hours: Array(24).fill(0) } }, { upsert: true });
  await Usage.updateOne({ device: deviceId, date }, { $inc: { [`hours.${hour}`]: wh } });
}

export async function countDevices(): Promise<number> {
  return Device.countDocuments();
}

export async function createDevices(items: Array<Record<string, unknown>>): Promise<DeviceState[]> {
  const docs = await Device.create(items);
  return docs.map(pub);
}

export async function createUsage(deviceId: string, date: string, hours: number[]): Promise<void> {
  await Usage.create({ device: deviceId, date, hours });
}

export async function isSeeded(): Promise<boolean> {
  return !!(await Setting.findOne({ key: "seeded" }));
}

export async function markSeeded(): Promise<void> {
  await Setting.updateOne({ key: "seeded" }, { $set: { value: { at: new Date() } } }, { upsert: true });
}

export async function createDevice(info: Record<string, unknown>): Promise<DeviceState> {
  const doc = await Device.create(info);
  return pub(doc);
}

export async function deleteDevice(id: string): Promise<boolean> {
  if (!mongoose.isValidObjectId(id)) return false;
  const doc = await Device.findByIdAndDelete(id);
  if (!doc) return false;
  await Usage.deleteMany({ device: id });
  await Command.deleteMany({ device: id });
  return true;
}
