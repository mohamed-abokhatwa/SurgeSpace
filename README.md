# SurgeSpace

Surge (water hammer) analysis for pipelines and networks, in the browser.

- Engine: `src/engine/` — steady state (global gradient), transient (method of characteristics on exact geometry, discrete gas cavity model, unsteady friction, pumps with inertia, surge vessels, air valves, relief valves), rigid columns for very short pipes, design checks, uncertainty envelopes, automatic surge vessel and air valve sizing.
- Inputs: EPANET .inp, spreadsheets (paste, CSV, XLSX), long-section profiles, DXF drawings.
- Tests: `npx tsx tests/engine.test.ts` (Joukowsky, line packing, column separation, junction transmission, time-step selection).

```bash
npm install
npm run dev
```
