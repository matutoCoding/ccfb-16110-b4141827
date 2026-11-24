import { judgeCooling } from './cct';
import { convectionAt, occlusionByScreens } from './environment';
import { geoInfo } from './geometry';
import type { Forging, SiteObject, ThermalResult, ThermalSample, Trajectory, Vec2 } from './types';

const SIGMA = 5.670374419e-8;
const RHO = 7850;
const CP = 620;
const K_STEEL = 32;
const EPS = 0.82;
const SHELL_FRACTION = 0.3;

export interface ThermalOptions {
  durationSec?: number;
  sampleSec?: number;
  dt?: number;
  ambientC?: number;
  objects?: SiteObject[];
  skipRecommend?: boolean;
}

interface Pair {
  i: number;
  j: number;
  exchangeArea: number;
}

interface PieceThermal {
  forging: Forging;
  area: number;
  heatCapacity: number;
  shellCapacity: number;
  coreCapacity: number;
  conductance: number;
  hConv: number;
  fEnv: number;
}

const k2 = (c: number): number => c + 273.15;

const buildPieces = (forgings: Forging[], ambientC: number, objects: SiteObject[]): PieceThermal[] =>
  forgings.map((forging) => {
    const g = geoInfo(forging.kind, forging.dims);
    const heatCapacity = RHO * g.volume * CP;
    const lc = Math.max(0.025, g.volume / g.area);
    const conductance = (3 * K_STEEL * g.volume) / (lc * lc);
    return {
      forging,
      area: g.area,
      heatCapacity,
      shellCapacity: heatCapacity * SHELL_FRACTION,
      coreCapacity: heatCapacity * (1 - SHELL_FRACTION),
      conductance,
      hConv: convectionAt(forging.position, objects),
      fEnv: 1,
    };
  });

const buildPairs = (pieces: PieceThermal[], objects: SiteObject[]): Pair[] => {
  const pairs: Pair[] = [];
  const screens = objects.filter((o) => o.type === 'screen');
  const fSum = new Array(pieces.length).fill(0);

  for (let i = 0; i < pieces.length; i++) {
    const a = pieces[i].forging;
    const ga = geoInfo(a.kind, a.dims);
    for (let j = i + 1; j < pieces.length; j++) {
      const b = pieces[j].forging;
      const gb = geoInfo(b.kind, b.dims);
      const dx = a.position.x - b.position.x;
      const dz = a.position.z - b.position.z;
      const r = Math.hypot(dx, dz);
      const maxR = Math.max(8.5, (ga.radius + gb.radius) * 3.4 + 2.5);
      if (r > maxR || r < 0.01) continue;

      const visible = occlusionByScreens(
        { ...a.position, y: ga.height * 0.55 },
        { ...b.position, y: gb.height * 0.55 },
        screens,
      );
      if (visible < 0.02) continue;

      const raw = (ga.projectedArea * gb.projectedArea) / (Math.PI * r * r);
      const exchangeArea =
        visible * Math.min(raw * 2.4, 0.1 * Math.min(pieces[i].area, pieces[j].area));
      if (exchangeArea < 0.01) continue;
      pairs.push({ i, j, exchangeArea });
      fSum[i] += exchangeArea / pieces[i].area;
      fSum[j] += exchangeArea / pieces[j].area;
    }
  }

  pieces.forEach((p, i) => {
    p.fEnv = Math.max(0.38, 1 - fSum[i]);
  });
  return pairs;
};

const derivative = (
  ts: Float64Array,
  tc: Float64Array,
  ds: Float64Array,
  dc: Float64Array,
  pieces: PieceThermal[],
  pairs: Pair[],
  ambientC: number,
): void => {
  const ak = k2(ambientC);
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    const tk = k2(ts[i]);
    const qRad = EPS * SIGMA * p.area * p.fEnv * (tk * tk * tk * tk - ak * ak * ak * ak);
    const qConv = p.hConv * p.area * (ts[i] - ambientC);
    ds[i] = (p.conductance * (tc[i] - ts[i]) - qRad - qConv) / p.shellCapacity;
    dc[i] = (-p.conductance * (tc[i] - ts[i])) / p.coreCapacity;
  }

  for (const pair of pairs) {
    const ti = k2(ts[pair.i]);
    const tj = k2(ts[pair.j]);
    const q = EPS * EPS * SIGMA * pair.exchangeArea * (tj ** 4 - ti ** 4);
    ds[pair.i] += q / pieces[pair.i].shellCapacity;
    ds[pair.j] -= q / pieces[pair.j].shellCapacity;
  }
};

export const simulateThermal = (forgings: Forging[], options: ThermalOptions = {}): ThermalResult => {
  const durationSec = options.durationSec ?? 36_000;
  const sampleSec = options.sampleSec ?? 60;
  const dt = options.dt ?? 5;
  const ambientC = options.ambientC ?? 36;
  const objects = options.objects ?? [];
  const n = forgings.length;
  const frames = Math.floor(durationSec / sampleSec) + 1;
  const times = new Float32Array(frames);
  for (let f = 0; f < frames; f++) times[f] = f * sampleSec;

  const surface = new Float32Array(n * frames);
  const core = new Float32Array(n * frames);
  const avg = new Float32Array(n * frames);
  const rates = new Float32Array(n * frames);
  const byId = new Map<string, Trajectory>();
  if (!n) return { durationSec, sampleSec, byId, times, surface, core, avg, rates, pieceIds: [] };

  const pieces = buildPieces(forgings, ambientC, objects);
  const pairs = buildPairs(pieces, objects);
  const ts = Float64Array.from(forgings, (f) => f.dischargeTempC);
  const tc = Float64Array.from(ts);
  const tmpS = new Float64Array(n);
  const tmpC = new Float64Array(n);
  const k1s = new Float64Array(n);
  const k1c = new Float64Array(n);
  const k2s = new Float64Array(n);
  const k2c = new Float64Array(n);
  const k3s = new Float64Array(n);
  const k3c = new Float64Array(n);
  const k4s = new Float64Array(n);
  const k4c = new Float64Array(n);
  const pieceIds = forgings.map((f) => f.id);

  const storeFrame = (frame: number, elapsed: number): void => {
    for (let i = 0; i < n; i++) {
      const idx = i * frames + frame;
      const a = (SHELL_FRACTION * ts[i] + (1 - SHELL_FRACTION) * tc[i]);
      surface[idx] = ts[i];
      core[idx] = tc[i];
      avg[idx] = a;
      if (frame > 0) {
        const prev = avg[i * frames + frame - 1];
        rates[idx] = (a - prev) / Math.max(1, elapsed - (frame - 1) * sampleSec);
      }
    }
  };
  storeFrame(0, 0);

  let frame = 1;
  let elapsed = 0;
  const steps = Math.round(durationSec / dt);
  for (let step = 0; step < steps; step++) {
    derivative(ts, tc, k1s, k1c, pieces, pairs, ambientC);
    for (let i = 0; i < n; i++) {
      tmpS[i] = ts[i] + (dt / 2) * k1s[i];
      tmpC[i] = tc[i] + (dt / 2) * k1c[i];
    }
    derivative(tmpS, tmpC, k2s, k2c, pieces, pairs, ambientC);
    for (let i = 0; i < n; i++) {
      tmpS[i] = ts[i] + (dt / 2) * k2s[i];
      tmpC[i] = tc[i] + (dt / 2) * k2c[i];
    }
    derivative(tmpS, tmpC, k3s, k3c, pieces, pairs, ambientC);
    for (let i = 0; i < n; i++) {
      tmpS[i] = ts[i] + dt * k3s[i];
      tmpC[i] = tc[i] + dt * k3c[i];
    }
    derivative(tmpS, tmpC, k4s, k4c, pieces, pairs, ambientC);
    for (let i = 0; i < n; i++) {
      ts[i] += (dt / 6) * (k1s[i] + 2 * k2s[i] + 2 * k3s[i] + k4s[i]);
      tc[i] += (dt / 6) * (k1c[i] + 2 * k2c[i] + 2 * k3c[i] + k4c[i]);
    }
    elapsed += dt;
    if (frame < frames && Math.abs(elapsed - frame * sampleSec) < dt * 0.5) {
      storeFrame(frame, elapsed);
      frame++;
    }
  }

  for (let i = 0; i < n; i++) {
    const samples: ThermalSample[] = [];
    let t800 = -1;
    let t500 = -1;
    let minRate = 0;
    for (let f = 0; f < frames; f++) {
      const idx = i * frames + f;
      const a = avg[idx];
      samples.push({
        t: times[f],
        surfaceC: surface[idx],
        coreC: core[idx],
        avgC: a,
        rateCPerS: rates[idx],
      });
      if (t800 < 0 && a <= 800) t800 = times[f];
      if (t800 >= 0 && t500 < 0 && a <= 500) t500 = times[f];
      if (f > 2 && a > 420 && a < 820) minRate = Math.min(minRate, rates[idx]);
    }
    const rate85 = t800 >= 0 && t500 > t800 ? 300 / (t500 - t800) : Math.abs(minRate);
    const judgement = judgeCooling(forgings[i].steel, rate85);
    byId.set(forgings[i].id, {
      pieceId: forgings[i].id,
      samples,
      rate85,
      minRate: Math.abs(minRate),
      failed: !judgement.pass,
    });
  }

  if (!options.skipRecommend) {
    recommendPositions(forgings, pieces, pairs, byId, objects);
  }
  return { durationSec, sampleSec, byId, times, surface, core, avg, rates, pieceIds };
};

const isolatedRateCache = new Map<string, number>();

const isolatedRate = (forging: Forging, ambientC: number): number => {
  const key = `${forging.kind}:${JSON.stringify(forging.dims)}:${forging.steel}:${forging.dischargeTempC}`;
  const cached = isolatedRateCache.get(key);
  if (cached !== undefined) return cached;
  const one = simulateThermal([forging], {
    durationSec: 5400,
    sampleSec: 30,
    dt: 5,
    ambientC,
    objects: [],
    skipRecommend: true,
  }).byId.get(forging.id)?.rate85 ?? 0.1;
  isolatedRateCache.set(key, one);
  return one;
};

const recommendPositions = (
  forgings: Forging[],
  pieces: PieceThermal[],
  pairs: Pair[],
  byId: Map<string, Trajectory>,
  objects: SiteObject[],
): void => {
  const neighborK = new Array(forgings.length).fill(0);
  for (const p of pairs) {
    neighborK[p.i] += p.exchangeArea;
    neighborK[p.j] += p.exchangeArea;
  }
  const fans = objects.filter((o) => o.type === 'fan');

  forgings.forEach((f, i) => {
    const tr = byId.get(f.id);
    if (!tr) return;
    const required = judgeCooling(f.steel, tr.rate85).requiredCPerS * 1.12;
    const iso = isolatedRate(f, 36);
    if (tr.failed) {
      const penalty = Math.max(0.02, 1 - tr.rate85 / Math.max(iso, 0.001));
      const desiredPenalty = Math.max(0.005, 1 - required / iso);
      const exchangeScale = Math.min(1, desiredPenalty / penalty);
      const distanceScale = Math.sqrt(1 / Math.max(0.18, exchangeScale));
      const currentSpacing = Math.max(
        ...forgings
          .filter((o) => o.id !== f.id)
          .map((o) => Math.hypot(o.position.x - f.position.x, o.position.z - f.position.z))
          .filter((d) => d < 9),
        3.2,
      );
      tr.suggestedSpacing = Math.min(8.5, Math.max(currentSpacing * 1.12, currentSpacing * distanceScale));

      let best: Vec2 | undefined;
      let bestBoost = 0;
      for (const fan of fans) {
        const yaw = fan.yaw ?? 0;
        const fx = Math.sin(yaw);
        const fz = -Math.cos(yaw);
        for (const along of [6, 9, 12, 15]) {
          for (const side of [-2, 0, 2]) {
            const candidate = { x: fan.x + fx * along - fz * side, z: fan.z + fz * along + fx * side };
            const boost = convectionAt(candidate, objects);
            if (boost > bestBoost) {
              bestBoost = boost;
              best = candidate;
            }
          }
        }
      }
      tr.target = best;
    }
    void pieces;
    void neighborK;
  });
};

export const temperatureAt = (result: ThermalResult, pieceIndex: number, timeSec: number, field: 'surface' | 'core' | 'avg' = 'avg'): number => {
  const frames = result.times.length;
  const pos = Math.min(frames - 1, Math.max(0, timeSec / result.sampleSec));
  const i0 = Math.floor(pos);
  const i1 = Math.min(frames - 1, i0 + 1);
  const t = pos - i0;
  const arr = field === 'surface' ? result.surface : field === 'core' ? result.core : result.avg;
  const a = arr[pieceIndex * frames + i0];
  const b = arr[pieceIndex * frames + i1];
  return a + (b - a) * t;
};
