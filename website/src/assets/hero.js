/* The hero trace: a real method-of-characteristics run, done in the page.
   A reservoir feeds a 1.8 km main over a ridge; the valve at the end closes in 5 s.
   Drawn as SurgeSpace draws a long section: the pipe, the steady grade line, the head now, and the
   maximum and minimum envelopes building up as the waves travel and reflect. */
(() => {
  const cv = document.getElementById('trace');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const readT = document.getElementById('trace-t');

  // ——— the run ———
  const g = 9.81, L = 1800, a = 1100, D = 0.6, f = 0.018, Hr = 110, V0 = 0.8, N = 48, Tc = 5, Em = 1.5, T = 26;
  const A = Math.PI * D * D / 4, Q0 = V0 * A, dx = L / N, dt = dx / a, B = a / (g * A), R = f * dx / (2 * g * D * A * A);
  const z = (x) => 8 + 47 * Math.exp(-(((x - 1100) / 260) ** 2)) + 6 * x / L;
  const H = new Float64Array(N + 1), Q = new Float64Array(N + 1).fill(Q0);
  for (let i = 0; i <= N; i++) H[i] = Hr - R * Q0 * Q0 * i;
  const steady = Float64Array.from(H), H0v = H[N];
  const steps = Math.round(T / dt), frames = [Float64Array.from(H)], tau = [1];
  for (let s = 1; s <= steps; s++) {
    const t = s * dt, Hn = new Float64Array(N + 1), Qn = new Float64Array(N + 1);
    for (let i = 1; i < N; i++) {
      const CP = H[i - 1] + B * Q[i - 1] - R * Q[i - 1] * Math.abs(Q[i - 1]);
      const CM = H[i + 1] - B * Q[i + 1] + R * Q[i + 1] * Math.abs(Q[i + 1]);
      Hn[i] = (CP + CM) / 2; Qn[i] = (CP - Hn[i]) / B;
    }
    Hn[0] = Hr; { const CM = H[1] - B * Q[1] + R * Q[1] * Math.abs(Q[1]); Qn[0] = (Hn[0] - CM) / B; }
    const ta = t >= Tc ? 0 : Math.pow(1 - t / Tc, Em);
    { const CP = H[N - 1] + B * Q[N - 1] - R * Q[N - 1] * Math.abs(Q[N - 1]); const Cv = (Q0 * ta) ** 2 / (2 * H0v); Qn[N] = -B * Cv + Math.sqrt((B * Cv) ** 2 + 2 * Cv * CP); Hn[N] = CP - B * Qn[N]; }
    H.set(Hn); Q.set(Qn); frames.push(Float64Array.from(H)); tau.push(ta);
  }
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i <= N; i++) lo = Math.min(lo, z(i * dx));
  frames.forEach((F) => F.forEach((h) => { hi = Math.max(hi, h); }));
  lo = Math.max(0, Math.floor((lo - 8) / 20) * 20); hi = Math.ceil((hi + 14) / 20) * 20;

  // ——— drawing ———
  const css = getComputedStyle(document.documentElement);
  const col = (n, d) => (css.getPropertyValue(n).trim() || d);
  const C = { gold: col('--gold', '#D2B879'), ember: col('--ember', '#FF8A33'), sky: col('--sky', '#8FC2F5'), ink2: col('--ink2', '#C3CAD6'), ink3: col('--ink3', '#8E9BB0'), line: col('--line2', '#24385C') };
  let W = 0, Hh = 0, dpr = 1;
  const pad = { l: 46, r: 16, t: 34, b: 30 };
  function size() {
    const r = cv.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(280, r.width); Hh = W * 10 / 16; cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const X = (i) => pad.l + (W - pad.l - pad.r) * i / N;
  const Y = (h) => pad.t + (Hh - pad.t - pad.b) * (hi - h) / (hi - lo);
  function line(arr, color, width, dash, glow) {
    ctx.save(); ctx.beginPath(); for (let i = 0; i <= N; i++) { const x = X(i), y = Y(arr[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []); ctx.lineJoin = 'round';
    if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
    ctx.stroke(); ctx.restore();
  }
  const zs = Array.from({ length: N + 1 }, (_, i) => z(i * dx));
  function draw(k) {
    ctx.clearRect(0, 0, W, Hh);
    ctx.font = '500 10.5px Jost, system-ui, sans-serif'; ctx.textBaseline = 'middle';
    // grid and level labels
    for (let h = lo; h <= hi; h += 40) {
      const y = Y(h); ctx.strokeStyle = 'rgba(36,56,92,.55)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
      ctx.fillStyle = C.ink3; ctx.textAlign = 'right'; ctx.fillText(h + ' m', pad.l - 8, y);
    }
    ctx.textAlign = 'center'; ctx.fillStyle = C.ink3;
    for (let c = 0; c <= L; c += 600) { ctx.textAlign = c === 0 ? 'left' : c >= L ? 'right' : 'center'; ctx.fillText((c / 1000).toFixed(1) + ' km', X(c / dx), Hh - pad.b + 16); }
    // the ground under the pipe
    ctx.save(); ctx.beginPath(); ctx.moveTo(X(0), Hh - pad.b); for (let i = 0; i <= N; i++) ctx.lineTo(X(i), Y(zs[i])); ctx.lineTo(X(N), Hh - pad.b); ctx.closePath();
    const gg = ctx.createLinearGradient(0, Y(60), 0, Hh - pad.b); gg.addColorStop(0, 'rgba(36,56,92,.55)'); gg.addColorStop(1, 'rgba(10,20,38,.2)'); ctx.fillStyle = gg; ctx.fill(); ctx.restore();
    line(zs, '#5D7396', 2.2);
    // envelopes so far
    const mx = Float64Array.from(frames[0]), mn = Float64Array.from(frames[0]);
    for (let s = 1; s <= k; s++) { const F = frames[s]; for (let i = 0; i <= N; i++) { if (F[i] > mx[i]) mx[i] = F[i]; if (F[i] < mn[i]) mn[i] = F[i]; } }
    line(steady, 'rgba(195,202,214,.55)', 1.2, [2, 4]);
    line(mx, C.gold, 1.6, [6, 4]);
    line(mn, C.sky, 1.6, [6, 4]);
    // the head now, with a soft fill down to the pipe
    const F = frames[k];
    ctx.save(); ctx.beginPath(); for (let i = 0; i <= N; i++) { const x = X(i), y = Y(F[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    for (let i = N; i >= 0; i--) ctx.lineTo(X(i), Y(zs[i])); ctx.closePath();
    const fg = ctx.createLinearGradient(0, Y(hi), 0, Y(lo)); fg.addColorStop(0, 'rgba(255,138,51,.20)'); fg.addColorStop(1, 'rgba(255,138,51,.02)'); ctx.fillStyle = fg; ctx.fill(); ctx.restore();
    line(F, C.ember, 2.6, null, 10);
    // reservoir and valve
    ctx.fillStyle = C.sky; ctx.fillRect(X(0) - 1, Y(Hr) - 1, 7, 2);
    ctx.save(); ctx.translate(X(N), Y(zs[N])); ctx.fillStyle = tau[k] > 0 ? C.gold : C.ember; ctx.beginPath(); ctx.moveTo(-6, -7); ctx.lineTo(6, 7); ctx.lineTo(6, -7); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill(); ctx.restore();
    // readouts
    const t = k * dt;
    ctx.textAlign = 'left'; ctx.fillStyle = C.ink2; ctx.font = '500 11px Jost, system-ui, sans-serif';
    ctx.fillText('RESERVOIR', pad.l + 4, pad.t - 18);
    ctx.textAlign = 'right'; ctx.fillText(tau[k] > 0 ? 'VALVE ' + Math.round(tau[k] * 100) + ' % OPEN' : 'VALVE CLOSED', W - pad.r, pad.t - 18);
    if (readT) readT.textContent = 't = ' + t.toFixed(1) + ' s · max ' + Math.round(Math.max(...mx)) + ' m';
  }

  // ——— the loop ———
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let k = 0, last = 0, hold = 0, visible = true, raf = 0;
  const pace = 1.45; // simulated seconds per real second
  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (!visible) { last = now; return; }
    const el = last ? (now - last) / 1000 : 0; last = now;
    if (k >= steps) { hold += el; if (hold > 2.2) { k = 0; hold = 0; } else return; }
    k = Math.min(steps, k + Math.max(1, Math.round(el * pace / dt)));
    draw(k);
  }
  const start = () => { size(); if (still) { draw(steps); return; } cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); };
  if ('IntersectionObserver' in window) new IntersectionObserver((es) => { visible = es[0].isIntersecting; }).observe(cv);
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { size(); draw(still ? steps : k); }, 120); });
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(start);
})();
