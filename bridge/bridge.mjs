#!/usr/bin/env node
// SurgeSpace data bridge: reads OPC UA and Modbus TCP tags on the plant network (read-only) and streams them to
// the SurgeSpace app over a local WebSocket as JSON [{ "tag": "...", "value": 12.3, "t": 1731300000.1 }, …].
// In SurgeSpace: Tools → Live data → Source: SurgeSpace data bridge, address ws://localhost:8765.
//   node bridge.mjs bridge.config.json
// Nothing is ever written to a PLC or OPC UA server.
import { readFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';

export async function startBridge(cfg, log = console.log) {
  const port = cfg.port ?? 8765;
  const pollMs = Math.max(cfg.pollMs ?? 1000, 100);
  const latest = new Map();
  const readers = [];
  // ── Modbus TCP ──
  for (const dev of cfg.modbus ?? []) {
    const { default: ModbusRTU } = await import('modbus-serial');
    const c = new ModbusRTU();
    await c.connectTCP(dev.host, { port: dev.port ?? 502 });
    c.setID(dev.unitId ?? 1);
    c.setTimeout(dev.timeoutMs ?? 2000);
    log(`Modbus ${dev.host}:${dev.port ?? 502} connected (${dev.tags.length} tags)`);
    readers.push(async () => {
      for (const t of dev.tags) {
        try {
          const words = t.dataType === 'float32' || t.dataType === 'int32' || t.dataType === 'uint32' ? 2 : 1;
          let v;
          if (t.type === 'coil') v = (await c.readCoils(t.register, 1)).data[0] ? 1 : 0;
          else if (t.type === 'discrete') v = (await c.readDiscreteInputs(t.register, 1)).data[0] ? 1 : 0;
          else {
            const r = t.type === 'input' ? await c.readInputRegisters(t.register, words) : await c.readHoldingRegisters(t.register, words);
            const b = r.buffer;
            const sw = t.wordOrder === 'little' && words === 2 ? Buffer.from([b[2], b[3], b[0], b[1]]) : b;
            v = t.dataType === 'float32' ? sw.readFloatBE(0) : t.dataType === 'int32' ? sw.readInt32BE(0) : t.dataType === 'uint32' ? sw.readUInt32BE(0) : t.dataType === 'int16' ? b.readInt16BE(0) : b.readUInt16BE(0);
          }
          latest.set(t.tag, { tag: t.tag, value: v * (t.scale ?? 1) + (t.offset ?? 0), t: Date.now() / 1000 });
        } catch (e) { log(`Modbus ${t.tag}: ${e.message}`); }
      }
    });
    readers.close = [...(readers.close ?? []), () => c.close(() => {})];
  }
  // ── OPC UA ──
  for (const srv of cfg.opcua ?? []) {
    const { OPCUAClient, AttributeIds, MessageSecurityMode, SecurityPolicy } = await import('node-opcua');
    const client = OPCUAClient.create({
      endpointMustExist: false, connectionStrategy: { maxRetry: 2, initialDelay: 500 },
      securityMode: MessageSecurityMode[srv.securityMode ?? 'None'], securityPolicy: SecurityPolicy[srv.securityPolicy ?? 'None'],
    });
    await client.connect(srv.endpoint);
    const session = srv.username ? await client.createSession({ type: 1, userName: srv.username, password: srv.password }) : await client.createSession();
    log(`OPC UA ${srv.endpoint} connected (${srv.tags.length} tags)`);
    readers.push(async () => {
      const res = await session.read(srv.tags.map((t) => ({ nodeId: t.nodeId, attributeId: AttributeIds.Value })));
      res.forEach((dv, i) => {
        const t = srv.tags[i];
        const raw = dv.value?.value;
        const v = typeof raw === 'boolean' ? (raw ? 1 : 0) : Number(raw);
        if (dv.statusCode.isGood() && Number.isFinite(v)) latest.set(t.tag, { tag: t.tag, value: v * (t.scale ?? 1) + (t.offset ?? 0), t: Date.now() / 1000 });
      });
    });
    readers.close = [...(readers.close ?? []), async () => { await session.close(); await client.disconnect(); }];
  }
  // ── stream to the app ──
  const wss = new WebSocketServer({ port, host: cfg.host ?? '127.0.0.1' });
  const filters = new Map();
  wss.on('connection', (ws) => {
    ws.on('message', (m) => { try { const j = JSON.parse(String(m)); if (Array.isArray(j.subscribe)) filters.set(ws, j.subscribe); } catch { /* ignore */ } });
    ws.on('close', () => filters.delete(ws));
  });
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try { for (const r of readers) await r(); } finally { busy = false; }
    const all = [...latest.values()];
    for (const ws of wss.clients) {
      const f = filters.get(ws);
      const out = f?.length ? all.filter((v) => f.some((p) => p === v.tag || (p.endsWith('*') && v.tag.startsWith(p.slice(0, -1))))) : all;
      if (out.length && ws.readyState === 1) ws.send(JSON.stringify(out));
    }
  }, pollMs);
  log(`Streaming to ws://${cfg.host ?? '127.0.0.1'}:${port}`);
  return { stop: async () => { clearInterval(timer); wss.close(); for (const c of readers.close ?? []) await c(); } };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const file = process.argv[2] ?? 'bridge.config.json';
  startBridge(JSON.parse(readFileSync(file, 'utf8'))).catch((e) => { console.error(e.message); process.exit(1); });
}
