// Live data check against a real MQTT broker over WebSocket (Aedes) — run where aedes and ws are installed:
//   NODE_PATH=<dir with aedes, ws> npx tsx validation/live-mqtt-check.ts
import { createRequire } from 'node:module';
import { connectLive, type WSFactory } from '../src/app/live';
const require = createRequire(import.meta.url);
const aedes = require('aedes')();
const { WebSocketServer, createWebSocketStream, WebSocket } = require('ws');
const wss = new WebSocketServer({ port: 18883 });
wss.on('connection', (ws: unknown) => aedes.handle(createWebSocketStream(ws)));
const got: string[] = [];
const factory: WSFactory = (url, p) => new WebSocket(url, p);
const stop = connectLive({ kind: 'mqtt', url: 'ws://127.0.0.1:18883', topics: ['plant/#'], username: 'u', password: 'p' }, (v) => got.push(`${v.tag}=${v.value}`), (s) => got.push(`[${s}]`), factory);
setTimeout(() => {
  aedes.publish({ topic: 'plant/PS1/discharge_pressure', payload: Buffer.from('42.5'), qos: 0, retain: false, cmd: 'publish', dup: false }, () => {});
  aedes.publish({ topic: 'plant/TANK/level', payload: Buffer.from('{"value": 3.25, "unit": "m"}'), qos: 0, retain: false, cmd: 'publish', dup: false }, () => {});
  aedes.publish({ topic: 'other/x', payload: Buffer.from('1'), qos: 0, retain: false, cmd: 'publish', dup: false }, () => {});
}, 600);
setTimeout(() => {
  stop();
  console.log(got.join('\n'));
  const ok = got.includes('plant/PS1/discharge_pressure=42.5') && got.includes('plant/TANK/level=3.25') && !got.some((g) => g.startsWith('other/'));
  console.log(ok ? 'PASS live MQTT over WebSocket: subscribe, numeric and JSON payloads, topic filter' : 'FAIL live MQTT');
  wss.close(); aedes.close();
  process.exit(ok ? 0 : 1);
}, 1500);
