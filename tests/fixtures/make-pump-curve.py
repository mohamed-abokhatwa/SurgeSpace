# A pump data sheet graph (raster, as a scanned or exported curve), with the axis and curve positions in page
# fractions for the digitising test. Head in metres against flow in m3/h, with efficiency and NPSH curves as clutter.
#   python3 tests/fixtures/make-pump-curve.py tests/fixtures
import json, sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

out = sys.argv[1] if len(sys.argv) > 1 else '.'
q = np.linspace(0, 900, 60)
h = 62 - 0.000035 * q ** 2 - 0.004 * q          # head, m (flow in m3/h)
eta = 85 * (1 - ((q - 560) / 560) ** 2)          # efficiency, %
fig, ax = plt.subplots(figsize=(8, 6), dpi=100)
ax.plot(q, h, color='#1f4e9a', lw=2.2, label='Ø 410 mm')
ax.plot(q, np.clip(eta, 0, None) * 0.6, color='#999999', lw=1, ls='--', label='η (scaled)')
ax.plot(q, 2 + 0.00001 * q ** 2, color='#bb5500', lw=1, label='NPSHr')
ax.set_xlim(0, 1000); ax.set_ylim(0, 80)
ax.set_xlabel('Q (m³/h)'); ax.set_ylabel('H (m)'); ax.grid(True, color='#dddddd')
ax.set_title('Pump type NK 150-400, 1480 rpm'); ax.legend(loc='upper right')
fig.savefig(f'{out}/pump-curve.png')
W, H = fig.canvas.get_width_height()
frac = lambda x, y: (lambda p: [float(p[0] / W), float(1 - p[1] / H)])(ax.transData.transform((x, y)))
qs = [0, 150, 300, 450, 600, 750, 900]
json.dump({
  'axes': {'x1': [frac(0, 0)[0], 0], 'x2': [frac(1000, 0)[0], 1000], 'y1': [frac(0, 0)[1], 0], 'y2': [frac(0, 80)[1], 80]},
  'axisPoints': {'x1': frac(0, 0), 'x2': frac(1000, 0), 'y1': frac(0, 0), 'y2': frac(0, 80)},
  'curve': [{'at': frac(x, 62 - 0.000035 * x ** 2 - 0.004 * x), 'q_m3h': x, 'h_m': 62 - 0.000035 * x ** 2 - 0.004 * x} for x in qs],
}, open(f'{out}/pump-curve.json', 'w'), indent=1)
