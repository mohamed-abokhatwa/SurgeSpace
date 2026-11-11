# Reference results for emitters and pressure-driven demand (EPANET 2.2 through WNTR's EpanetSimulator).
#   python3 validation/data/make-pda-reference.py  → writes Net1emit.inp/.json, Net1pda.inp/.json
# Units: SI (m, m3/s). One row per report time.
import json, os, wntr
here = os.path.dirname(os.path.abspath(__file__))
base = open(os.path.join(here, 'Net1.inp')).read()
variants = {
    # leakage at three junctions (gpm at 1 psi), exponent 0.5
    'Net1emit': base.replace('[END]', '[EMITTERS]\n 11  2.0\n 22  3.5\n 31  1.0\n\n[END]'),
    # pressure-driven demand: full demand only above 120 psi, none below 20 psi (several junctions short)
    'Net1pda': base.replace(' Emitter Exponent   \t0.5', ' Emitter Exponent   \t0.5\n Demand Model  PDA\n Minimum Pressure  20\n Required Pressure  120\n Pressure Exponent  0.5')
                   .replace('[END]', '[EMITTERS]\n 22  3.5\n\n[END]'),
}
for name, text in variants.items():
    path = os.path.join(here, f'{name}.inp')
    open(path, 'w').write(text)
    wn = wntr.network.WaterNetworkModel(path)
    wn.options.quality.parameter = 'NONE'
    res = wntr.sim.EpanetSimulator(wn).run_sim(file_prefix=os.path.join(os.getcwd(), f'tmp_{name}'))
    out = {
        'times': [float(t) for t in res.node['head'].index],
        'head': {k: [float(x) for x in v] for k, v in res.node['head'].items()},
        'demand': {k: [float(x) for x in v] for k, v in res.node['demand'].items()},
        'flow': {k: [float(x) for x in v] for k, v in res.link['flowrate'].items()},
    }
    if 'leak_demand' in res.node:
        out['emitter'] = {k: [float(x) for x in v] for k, v in res.node['leak_demand'].items()}
    json.dump(out, open(os.path.join(here, f'{name}.json'), 'w'), separators=(',', ':'))
    print(name, len(out['times']), 'times', 'demand model', wn.options.hydraulic.demand_model)
