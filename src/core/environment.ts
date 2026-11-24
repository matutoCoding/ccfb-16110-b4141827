import { clamp } from './format';
import type { SiteObject, Vec2 } from './types';

export const screenShieldFactor = (o: SiteObject): number => {
  switch (o.material) {
    case 'aluminum':
      return 0.98;
    case 'watercooled':
      return 0.995;
    case 'ceramic':
      return 0.9;
    case 'steel':
    default:
      return 0.95;
  }
};

export const screenEmissivity = (o: SiteObject): number => {
  if (o.emissivity !== undefined) return o.emissivity;
  switch (o.material) {
    case 'aluminum':
      return 0.18;
    case 'watercooled':
      return 0.32;
    case 'ceramic':
      return 0.88;
    case 'steel':
    default:
      return 0.58;
  }
};

const toLocal = (p: Vec2, o: SiteObject): Vec2 => {
  const r = -(o.rotation ?? 0);
  const c = Math.cos(r);
  const s = Math.sin(r);
  const dx = p.x - o.x;
  const dz = p.z - o.z;
  return { x: dx * c - dz * s, z: dx * s + dz * c };
};

const segmentHitsRect = (a: Vec2, b: Vec2, o: SiteObject): { hit: boolean; t?: number } => {
  const p = toLocal(a, o);
  const q = toLocal(b, o);
  const minX = -o.width / 2;
  const maxX = o.width / 2;
  const minZ = -o.depth / 2;
  const maxZ = o.depth / 2;
  const dx = q.x - p.x;
  const dz = q.z - p.z;
  let tmin = 0;
  let tmax = 1;

  const axes: [number, number, number, number][] = [
    [p.x, dx, minX, maxX],
    [p.z, dz, minZ, maxZ],
  ];
  for (const [start, delta, min, max] of axes) {
    if (Math.abs(delta) < 1e-9) {
      if (start < min || start > max) return { hit: false };
    } else {
      let t1 = (min - start) / delta;
      let t2 = (max - start) / delta;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return { hit: false };
    }
  }
  return { hit: tmax >= 0 && tmin <= 1, t: clamp(tmin, 0, 1) };
};

export const occlusionByScreens = (
  a: Vec2 & { y?: number },
  b: Vec2 & { y?: number },
  screens: SiteObject[],
): number => {
  let visible = 1;
  const ya = a.y ?? 0.4;
  const yb = b.y ?? 1.4;
  for (const screen of screens) {
    if (screen.type !== 'screen') continue;
    const hit = segmentHitsRect(a, b, screen);
    if (!hit.hit || hit.t === undefined) continue;
    const lineY = ya + (yb - ya) * hit.t;
    const geometryBlock = clamp((screen.height - lineY + 0.35) / 0.7, 0, 1);
    const block = geometryBlock * screenShieldFactor(screen);
    visible *= 1 - block;
    if (visible <= 0.01) return 0;
  }
  return visible;
};

export const fanForward = (fan: SiteObject): Vec2 => {
  const yaw = fan.yaw ?? 0;
  return { x: Math.sin(yaw), z: -Math.cos(yaw) };
};

export const fanFactorAt = (p: Vec2, fans: SiteObject[]): number => {
  let best = 0;
  for (const fan of fans) {
    if (fan.type !== 'fan') continue;
    const f = fanForward(fan);
    const dx = p.x - fan.x;
    const dz = p.z - fan.z;
    const along = dx * f.x + dz * f.z;
    const side = Math.abs(dx * -f.z + dz * f.x);
    const range = 18 + fan.depth * 2;
    if (along < -2 || along > range) continue;
    const sigma = 1.6 + Math.max(0, along) * 0.22;
    const lateral = Math.exp(-(side * side) / (2 * sigma * sigma));
    const longitudinal = Math.exp(-Math.max(0, along) / (range * 0.72));
    const near = along < 0 ? 0.35 : 1;
    best = Math.max(best, lateral * longitudinal * near);
  }
  return clamp(best, 0, 1);
};

export const convectionAt = (p: Vec2, objects: SiteObject[]): number => {
  const fans = objects.filter((o) => o.type === 'fan');
  return 12 + 26 * fanFactorAt(p, fans);
};
