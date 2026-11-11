// Live SCADA data in the app.
//  • MQTT 3.1.1 over WebSocket (most SCADA gateways, IIoT platforms and brokers such as Mosquitto, HiveMQ,
//    EMQX, AWS IoT, Azure IoT Hub support it). Payloads: a number, or JSON {"value": …} / {"v": …}.
//  • SurgeSpace data bridge (bridge/): reads OPC UA servers and Modbus TCP devices on the plant network and
//    streams JSON {"tag": "...", "value": …, "t": …} over a local WebSocket.
// Only QoS 0 subscriptions are used (read-only); SurgeSpace never writes to the plant.

export interface LiveSource { kind: 'mqtt' | 'bridge'; url: string; topics?: string[]; username?: string; password?: string; clientId?: string }
export interface LiveValue { tag: string; value: number; t: number }
type WSLike = { binaryType: string; send(d: ArrayBuffer | Uint8Array | string): void; close(): void; onopen: ((e: unknown) => void) | null; onmessage: ((e: { data: unknown }) => void) | null; onclose: ((e: unknown) => void) | null; onerror: ((e: unknown) => void) | null };
export type WSFactory = (url: string, protocols?: string[]) => WSLike;
const defaultWS: WSFactory = (url, p) => new WebSocket(url, p) as unknown as WSLike;

// ── MQTT packet encoding ──
const enc = new TextEncoder(), dec = new TextDecoder();
function varLen(n: number): number[] { const out: number[] = []; do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 128; out.push(b); } while (n > 0); return out; }
const str = (s: string) => { const b = enc.encode(s); return [b.length >> 8, b.length & 255, ...b]; };
function packet(type: number, flags: number, body: number[]) { return new Uint8Array([(type << 4) | flags, ...varLen(body.length), ...body]); }
export function mqttConnect(clientId: string, user?: string, pass?: string, keepAlive = 30) {
  let fl = 0x02; // clean session
  if (user) fl |= 0x80;
  if (pass) fl |= 0x40;
  return packet(1, 0, [...str('MQTT'), 4, fl, keepAlive >> 8, keepAlive & 255, ...str(clientId), ...(user ? str(user) : []), ...(pass ? str(pass) : [])]);
}
export function mqttSubscribe(id: number, topics: string[]) { return packet(8, 2, [id >> 8, id & 255, ...topics.flatMap((t) => [...str(t), 0])]); }
export const mqttPing = () => new Uint8Array([0xc0, 0]);
export const mqttDisconnect = () => new Uint8Array([0xe0, 0]);
export function mqttPublish(topic: string, payload: string) { return packet(3, 0, [...str(topic), ...enc.encode(payload)]); }

/** Split a byte stream into MQTT packets; returns the parsed packets and the unused rest. */
export function mqttParse(buf: Uint8Array): { packets: { type: number; flags: number; body: Uint8Array }[]; rest: Uint8Array } {
  const packets: { type: number; flags: number; body: Uint8Array }[] = [];
  let i = 0;
  while (i < buf.length) {
    let mul = 1, len = 0, k = i + 1, b: number;
    do { if (k >= buf.length) return { packets, rest: buf.slice(i) }; b = buf[k++]; len += (b & 127) * mul; mul *= 128; } while (b & 128);
    if (k + len > buf.length) return { packets, rest: buf.slice(i) };
    packets.push({ type: buf[i] >> 4, flags: buf[i] & 15, body: buf.slice(k, k + len) });
    i = k + len;
  }
  return { packets, rest: new Uint8Array(0) };
}
export function readPayloadValue(payload: string): number {
  const s = payload.trim();
  if (/^-?\d/.test(s)) return Number(s);
  try { const j = JSON.parse(s); const v = typeof j === "number" || typeof j === "boolean" ? j : j.value ?? j.v ?? j.val ?? j.Value; return typeof v === 'boolean' ? (v ? 1 : 0) : Number(v); } catch { return s === 'true' || s === 'ON' ? 1 : s === 'false' || s === 'OFF' ? 0 : NaN; }
}

/** Connect to a live source. Calls onValue for each new value; returns a function that disconnects. */
export function connectLive(src: LiveSource, onValue: (v: LiveValue) => void, onStatus: (s: string) => void, ws: WSFactory = defaultWS): () => void {
  let sock: WSLike;
  try { sock = src.kind === 'mqtt' ? ws(src.url, ['mqtt']) : ws(src.url); } catch (e) { onStatus(`Could not connect: ${(e as Error).message}`); return () => {}; }
  sock.binaryType = 'arraybuffer';
  let rest: Uint8Array = new Uint8Array(0);
  let ping: ReturnType<typeof setInterval> | undefined;
  sock.onopen = () => {
    onStatus('Connected');
    if (src.kind === 'mqtt') sock.send(mqttConnect(src.clientId ?? `surgespace-${Math.random().toString(36).slice(2, 8)}`, src.username, src.password));
    else if (src.topics?.length) sock.send(JSON.stringify({ subscribe: src.topics }));
  };
  sock.onmessage = (e) => {
    if (src.kind === 'bridge') {
      try {
        const m = JSON.parse(String(e.data));
        for (const x of Array.isArray(m) ? m : [m]) if (x.tag !== undefined) onValue({ tag: String(x.tag), value: Number(x.value), t: Number(x.t ?? Date.now() / 1000) });
      } catch { /* ignore */ }
      return;
    }
    const data = new Uint8Array(e.data as ArrayBuffer);
    const all = new Uint8Array(rest.length + data.length);
    all.set(rest); all.set(data, rest.length);
    const { packets, rest: r } = mqttParse(all);
    rest = r;
    for (const p of packets) {
      if (p.type === 2) { // CONNACK
        if (p.body[1] !== 0) { onStatus(`Broker refused the connection (code ${p.body[1]}: ${['', 'protocol', 'client id', 'server unavailable', 'user name or password', 'not authorised'][p.body[1]] ?? 'error'})`); sock.close(); return; }
        sock.send(mqttSubscribe(1, src.topics?.length ? src.topics : ['#']));
        ping = setInterval(() => sock.send(mqttPing()), 20000);
        onStatus('Subscribed');
      } else if (p.type === 3) { // PUBLISH
        const tl = (p.body[0] << 8) | p.body[1];
        const topic = dec.decode(p.body.slice(2, 2 + tl));
        const qos = (p.flags >> 1) & 3;
        const payload = dec.decode(p.body.slice(2 + tl + (qos ? 2 : 0)));
        onValue({ tag: topic, value: readPayloadValue(payload), t: Date.now() / 1000 });
      }
    }
  };
  sock.onerror = () => onStatus('Connection error');
  sock.onclose = () => { if (ping) clearInterval(ping); onStatus('Disconnected'); };
  return () => { try { if (src.kind === 'mqtt') sock.send(mqttDisconnect()); } catch { /* closed */ } if (ping) clearInterval(ping); sock.close(); };
}
