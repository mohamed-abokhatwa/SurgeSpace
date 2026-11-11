// Bridge test with a local Modbus TCP server and a local OPC UA server.
import ModbusRTU from 'modbus-serial';
import { OPCUAServer, Variant, DataType } from 'node-opcua';
import { WebSocket } from 'ws';
import { startBridge } from './bridge.mjs';

const holding = new Array(200).fill(0);
const fb = Buffer.alloc(4); fb.writeFloatBE(4.25); holding[100] = fb.readUInt16BE(0); holding[101] = fb.readUInt16BE(2);
const mb = new ModbusRTU.ServerTCP({ getHoldingRegister: (a) => holding[a], getInputRegister: (a) => (a === 5 ? 325 : 0), getCoil: (a) => a === 10 }, { host: '127.0.0.1', port: 15020, unitID: 1 });
const ua = new OPCUAServer({ port: 14840, resourcePath: '/ua' });
await ua.initialize();
const ns = ua.engine.addressSpace.getOwnNamespace();
ns.addVariable({ organizedBy: ua.engine.addressSpace.rootFolder.objects, browseName: 'Level', nodeId: 's=Reservoir.Level', dataType: 'Double', value: { get: () => new Variant({ dataType: DataType.Double, value: 7.5 }) } });
await ua.start();
await new Promise((r) => setTimeout(r, 300));
const br = await startBridge({
  port: 18765, pollMs: 200,
  modbus: [{ host: '127.0.0.1', port: 15020, unitId: 1, tags: [
    { tag: 'P', register: 100, type: 'holding', dataType: 'float32', scale: 10 },
    { tag: 'L', register: 5, type: 'input', dataType: 'uint16', scale: 0.01 },
    { tag: 'RUN', register: 10, type: 'coil' },
  ] }],
  opcua: [{ endpoint: `opc.tcp://127.0.0.1:14840/ua`, tags: [{ tag: 'RES', nodeId: 'ns=1;s=Reservoir.Level' }] }],
}, () => {});
const got = new Map();
const ws = new WebSocket('ws://127.0.0.1:18765');
ws.on('message', (m) => { for (const v of JSON.parse(String(m))) got.set(v.tag, v.value); });
await new Promise((r) => setTimeout(r, 1500));
ws.close();
await br.stop(); await ua.shutdown(); mb.close(() => {});
const ok = Math.abs(got.get('P') - 42.5) < 1e-4 && Math.abs(got.get('L') - 3.25) < 1e-9 && got.get('RUN') === 1 && got.get('RES') === 7.5;
console.log(Object.fromEntries(got));
console.log(ok ? 'PASS bridge: Modbus float32/uint16/coil and OPC UA values streamed' : 'FAIL bridge');
process.exit(ok ? 0 : 1);
