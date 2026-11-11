# SurgeSpace data bridge

Reads live values from **OPC UA** servers and **Modbus TCP** devices on the plant network and streams them to
SurgeSpace (Tools → Live data → *SurgeSpace data bridge*, `ws://localhost:8765`). Read-only: it never writes to a
PLC or server. MQTT brokers are connected from the app directly (MQTT over WebSocket) and need no bridge.

```
cd bridge
npm install
cp bridge.config.example.json bridge.config.json   # edit endpoints, registers and node ids
npm start
```

Tag options: `scale` and `offset` convert to model units (m of head, m³/s, m), `dataType` uint16 / int16 / int32 /
uint32 / float32 (`wordOrder` "little" for swapped words), Modbus `type` holding / input / coil / discrete; OPC UA
`securityMode` None / Sign / SignAndEncrypt with `username` / `password` if the server asks for them.

`npm test` starts a local Modbus TCP server and a local OPC UA server and checks the values reach a client.
