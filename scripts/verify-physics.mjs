import { performance } from 'node:perf_hooks';
import { buildSeedData } from '../src/db/seed.ts';
import { simulateThermal } from '../src/core/thermal.ts';
import { geoInfo } from '../src/core/geometry.ts';
import { convectionAt, occlusionByScreens } from '../src/core/environment.ts';

const SIGMA = 5.670374419e-8;
const RHO = 7850;
const CP = 620;
const K = 32;
const EPS = 0.82;
const SHELL = 0.3;
const AMBIENT = 36;
const DURATION = 28800;
const SAMPLE = 60;

const data = buildSeedData();
const forgings = data.forgings;
const objects = data.objects;
const n = forgings.length;

const pieces = forgings.map((f) => {
  const g = geoInfo(f.kind, f.dims);
  const C = RHO * g.volume * CP;
  const lc = Math.max(0.025, g.volume / g.area);
  return {
    f,
    area: g.area,
    Cs: C * SHELL,
    Cc: C * (1 - SHELL),
    G: (3 * K * g.volume) / (lc * lc),
    h: convectionAt(f.position, objects),
    fEnv: 1,
  };
});

const pairs = [];
const fSum = new Array(n).fill(0);
const screens = objects.filter((o) => o.type === 'screen');
for (let i = 0; i < n; i++) {
  const ga = geoInfo(forgings[i].kind, forgings[i].dims);
  for (let j = i + 1; j < n; j++) {
    const gb = geoInfo(forgings[j].kind, forgings[j].dims);
    const dx = forgings[i].position.x - forgings[j].position.x;
    const dz = forgings[i].position.z - forgings[j].position.z;
    const r = Math.hypot(dx, dz);
    const maxR = Math.max(8.5, (ga.radius + gb.radius) * 3.4 + 2.5);
    if (r > maxR) continue;
    const vis = occlusionByScreens(
      { ...forgings[i].position, y: ga.height * 0.55 },
      { ...forgings[j].position, y: gb.height * 0.55 },
      screens,
    );
    if (vis < 0.02) continue;
    const raw = (ga.projectedArea * gb.projectedArea) / (Math.PI * r * r);
    const ex = vis * Math.min(raw * 2.4, 0.1 * Math.min(pieces[i].area, pieces[j].area));
    if (ex < 0.01) continue;
    pairs.push({ i, j, ex });
    fSum[i] += ex / pieces[i].area;
    fSum[j] += ex / pieces[j].area;
  }
}
pieces.forEach((p, i) => (p.fEnv = Math.max(0.38, 1 - fSum[i])));

const deriv = (ts, tc, ds, dc) => {
  const ak = AMBIENT + 273.15;
  for (let i = 0; i < n; i++) {
    const p = pieces[i];
    const tk = ts[i] + 273.15;
    const qRad = EPS * SIGMA * p.area * p.fEnv * (tk ** 4 - ak ** 4);
    const qConv = p.h * p.area * (ts[i] - AMBIENT);
    ds[i] = (p.G * (tc[i] - ts[i]) - qRad - qConv) / p.Cs;
    dc[i] = -p.G * (tc[i] - ts[i]) / p.Cc;
  }
  for (const p of pairs) {
    const ti = ts[p.i] + 273.15;
    const tj = ts[p.j] + 273.15;
    const q = EPS * EPS * SIGMA * p.ex * (tj ** 4 - ti ** 4);
    ds[p.i] += q / pieces[p.i].Cs;
    ds[p.j] -= q / pieces[p.j].Cs;
  }
};

const dt = 2;
const ts = Float64Array.from(forgings, (f) => f.dischargeTempC);
const tc = Float64Array.from(ts);
const refs = Array.from({ length: n }, () => []);
for (let i = 0; i < n; i++) refs[i].push({ s: ts[i], c: tc[i], a: SHELL * ts[i] + (1 - SHELL) * tc[i] });
const k1s = new Float64Array(n), k1c = new Float64Array(n);
const k2s = new Float64Array(n), k2c = new Float64Array(n);
const k3s = new Float64Array(n), k3c = new Float64Array(n);
const k4s = new Float64Array(n), k4c = new Float64Array(n);
const ws = new Float64Array(n), wc = new Float64Array(n);

for (let step = 0; step < DURATION / dt; step++) {
  deriv(ts, tc, k1s, k1c);
  for (let i = 0; i < n; i++) { ws[i] = ts[i] + dt / 2 * k1s[i]; wc[i] = tc[i] + dt / 2 * k1c[i]; }
  deriv(ws, wc, k2s, k2c);
  for (let i = 0; i < n; i++) { ws[i] = ts[i] + dt / 2 * k2s[i]; wc[i] = tc[i] + dt / 2 * k2c[i]; }
  deriv(ws, wc, k3s, k3c);
  for (let i = 0; i < n; i++) { ws[i] = ts[i] + dt * k3s[i]; wc[i] = tc[i] + dt * k3c[i]; }
  deriv(ws, wc, k4s, k4c);
  for (let i = 0; i < n; i++) {
    ts[i] += dt / 6 * (k1s[i] + 2 * k2s[i] + 2 * k3s[i] + k4s[i]);
    tc[i] += dt / 6 * (k1c[i] + 2 * k2c[i] + 2 * k3c[i] + k4c[i]);
  }
  if ((step + 1) % (SAMPLE / dt) === 0) {
    for (let i = 0; i < n; i++) refs[i].push({ s: ts[i], c: tc[i], a: SHELL * ts[i] + (1 - SHELL) * tc[i] });
  }
}

const started = performance.now();
const engine = simulateThermal(forgings, { objects, ambientC: AMBIENT, durationSec: DURATION, sampleSec: SAMPLE, dt: 5 });
const engineMs = performance.now() - started;

const centerIndex = forgings.findIndex((f) => Math.hypot(f.position.x, f.position.z + 1) < 4);
const picks = [...new Set([0, centerIndex, n - 1].filter((i) => i >= 0))];
let globalMax = 0;
const rows = [];
for (const idx of picks) {
  const tr = engine.byId.get(forgings[idx].id);
  let maxErr = 0;
  let maxAt = 0;
  let fieldWorst = '';
  tr.samples.forEach((sample, frame) => {
    const ref = refs[idx][frame];
    for (const field of ['surfaceC', 'coreC', 'avgC']) {
      const got = sample[field];
      const want = field === 'surfaceC' ? ref.s : field === 'coreC' ? ref.c : ref.a;
      const err = Math.abs(got - want) / Math.max(1, want) * 100;
      if (err > maxErr) { maxErr = err; maxAt = sample.t; fieldWorst = field; }
      globalMax = Math.max(globalMax, err);
    }
  });
  rows.push({ code: forgings[idx].code, maxErr, maxAt, fieldWorst, rate85: tr.rate85 });
}

console.log('物理公式独立复核（RK4 dt=2s 参考解 vs 产品 dt=5s）');
console.table(rows.map((r) => ({ 件号: r.code, 最大百分比误差: `${r.maxErr.toFixed(3)}%`, 时刻: `${r.maxAt}s`, 曲线: r.fieldWorst, 冷速85: r.rate85.toFixed(4) })));
console.log(`全批次推演耗时: ${engineMs.toFixed(0)}ms, 件数: ${n}, 配对数: ${pairs.length}`);
if (globalMax >= 3) {
  console.error(`复核失败：最大误差 ${globalMax.toFixed(3)}% >= 3%`);
  process.exit(1);
}
console.log(`复核通过：三件全曲线最大误差 ${globalMax.toFixed(3)}% < 3%`);
