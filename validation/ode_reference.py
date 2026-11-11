"""Independent check of the surge engines: the same physics written as ordinary differential equations and
integrated with SciPy (Radau, tight tolerances). Reads a case description from validation/ode-check.ts, writes
time histories back. No code is shared with SurgeSpace.
  python3 validation/ode_reference.py spec.json out.json"""
import json, math, sys
from scipy.integrate import solve_ivp

G = 9.80665
NU = None

def darcy_f(q, d, eps_mm, nu):
    a = math.pi / 4 * d * d
    v = abs(q) / a
    re = max(v * d / nu, 1)
    lam = 64 / re
    rr = eps_mm / 1000 / d
    turb = 0.25 / math.log10(rr / 3.7 + 5.74 / max(re, 4000) ** 0.9) ** 2
    if re <= 2000: return lam
    if re >= 4000: return turb
    w = (re - 2000) / 2000
    return lam * (1 - w) + turb * w

def pipe_r(p, q, nu):
    a = math.pi / 4 * p['D'] ** 2
    return darcy_f(q, p['D'], p['eps'], nu) * p['L'] / (2 * G * p['D'] * a * a)

def diff_tank(s):
    # reservoir → tunnel → differential tank (riser + chamber through ports); the downstream valve is shut at t = 0
    tun, nu = s['tunnel'], s['nu']
    A = math.pi / 4 * tun['D'] ** 2
    Ar = math.pi / 4 * s['riserD'] ** 2
    Ac = math.pi / 4 * s['outerD'] ** 2 - Ar
    rp = 1 / (2 * G * s['cd'] ** 2 * s['port'] ** 2)
    def rhs(t, y):
        Q, zr, zc = y
        dQ = G * A / tun['L'] * (s['H0'] - zr - pipe_r(tun, Q, nu) * Q * abs(Q))
        dz = zr - zc
        Qp = math.copysign(math.sqrt(abs(dz) / rp), dz)
        return [dQ, (Q - Qp) / Ar, Qp / Ac]
    y0 = [s['Q0'], s['z0'], s['z0']]
    ts = [k * s['dtOut'] for k in range(int(s['T'] / s['dtOut']) + 1)]
    sol = solve_ivp(rhs, (0, s['T']), y0, method='Radau', t_eval=ts, rtol=1e-9, atol=1e-10, max_step=0.5)
    return {'t': list(sol.t), 'riser': list(sol.y[1]), 'chamber': list(sol.y[2]), 'Q': list(sol.y[0])}

def motor_start(s):
    # sump → pump (ideal non-return valve) → main → tank, as one rigid column; the rotor follows motor − pump torque
    nu = s['nu']
    LA = sum(p['L'] / (math.pi / 4 * p['D'] ** 2) for p in s['pipes'])
    h0, B, C = s['pump']['h0'], s['pump']['B'], s['pump']['C']  # EPANET three-point curve h0 − B·q^C
    ta, tb, tc = s['pump']['ta'], s['pump']['tb'], s['pump']['tc']
    curve = s['motorCurve']
    Tr, I, w = s['Tr'], s['I'], s['w']
    def tm(al):
        if al >= curve[-1][0]: return (curve[-1][1] - (al - curve[-1][0]) * 30) * Tr
        for k in range(1, len(curve)):
            if al <= curve[k][0]:
                x0, y0 = curve[k - 1]; x1, y1 = curve[k]
                return (y0 + (y1 - y0) * (al - x0) / (x1 - x0)) * Tr
        return curve[-1][1] * Tr
    def hp(al, q):
        if al < 1e-4: return -50 * q * abs(q)
        qq = q / al
        return al * al * (h0 - B * max(qq, 0) ** C) if qq >= 0 else al * al * h0
    def rhs(t, y):
        al, Q = y
        drive = s['Hs'] + hp(al, Q) - s['Hd'] - sum(pipe_r(p, Q, nu) for p in s['pipes']) * Q * abs(Q)
        dQ = G / LA * drive
        if Q <= 0 and dQ < 0: dQ = 0  # the non-return valve holds
        Tp = ta * al * al + tb * al * max(Q, 0) + tc * max(Q, 0) ** 2
        return [(tm(al) - Tp) / (I * w), dQ]
    ts = [k * s['dtOut'] for k in range(int(s['T'] / s['dtOut']) + 1)]
    sol = solve_ivp(rhs, (0, s['T']), [0.0, 0.0], method='Radau', t_eval=ts, rtol=1e-9, atol=1e-11, max_step=0.01)
    return {'t': list(sol.t), 'speed': list(sol.y[0]), 'Q': list(sol.y[1])}

spec = json.load(open(sys.argv[1]))
out = {k: (diff_tank(v) if v['kind'] == 'diffTank' else motor_start(v)) for k, v in spec.items()}
json.dump(out, open(sys.argv[2], 'w'))
print('ODE reference:', ', '.join(f"{k} {len(v['t'])} points" for k, v in out.items()))
