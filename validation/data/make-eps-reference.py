# Reference results for the extended-period and water-quality validation, from EPANET 2.2 through WNTR.
#   python3 validation/data/make-eps-reference.py   (writes validation/data/<net>.eps.json)
# Units: SI (m, m3/s); chemical mg/L, age h, trace %. One row per report time.
import json, os, sys, wntr
here = os.path.dirname(os.path.abspath(__file__))
for name in ['Net1', 'Net2', 'Net3']:
    for mode in ['file', 'AGE']:
        wn = wntr.network.WaterNetworkModel(os.path.join(here, f'{name}.inp'))
        if mode == 'AGE':
            wn.options.quality.parameter = 'AGE'
        res = wntr.sim.EpanetSimulator(wn).run_sim(file_prefix=os.path.join(os.getcwd(), f'tmp_{name}'))
        out = {
            'times': [float(t) for t in res.node['head'].index],
            'head': {k: [float(x) for x in v] for k, v in res.node['head'].items()},
            'flow': {k: [float(x) for x in v] for k, v in res.link['flowrate'].items()},
            'quality': {k: [float(x) for x in v] for k, v in res.node['quality'].items()},
        }
        if mode == 'file' and wn.options.quality.parameter.upper() not in ('AGE', 'TRACE', 'NONE'):
            out['quality'] = {k: [x * 1000 for x in v] for k, v in out['quality'].items()}  # WNTR kg/m3 -> mg/L
        if mode == 'AGE':
            out['quality'] = {k: [x / 3600 for x in v] for k, v in out['quality'].items()}  # s -> h
            out = {'times': out['times'], 'quality': out['quality']}
        suffix = '' if mode == 'file' else '.age'
        with open(os.path.join(here, f'{name}{suffix}.eps.json'), 'w') as f:
            json.dump(out, f, separators=(',', ':'))
        print(name, mode, len(out['times']), 'times')
