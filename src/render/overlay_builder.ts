import { geoInfo } from '../core/geometry';
import { blackbodyRgb } from './blackbody';
import { composeModel, type Mat4 } from './mat4';
import type { AppData, ID } from '../core/types';

export interface OverlayInstance {
  model: Mat4;
  color: [number, number, number, number];
  options: [number, number, number, number];
}

export interface OverlaySet {
  normal: OverlayInstance[];
  glow: OverlayInstance[];
}

export const buildOverlays = (
  data: AppData,
  tempsC: Float32Array,
  failed: Set<ID>,
  selectedId?: ID,
): OverlaySet => {
  const normal: OverlayInstance[] = [];
  const glow: OverlayInstance[] = [];

  data.forgings.forEach((f, i) => {
    const g = geoInfo(f.kind, f.dims);
    const temp = tempsC[i] ?? f.dischargeTempC;
    const [r, gg, b] = blackbodyRgb(temp);
    const heat = Math.max(0, Math.min(1, (temp - 360) / 520));
    if (heat > 0.02) {
      const size = g.radius * (4.2 + heat * 4.5);
      glow.push({
        model: composeModel(f.position.x, 0.07, f.position.z, 0, size, 1, size),
        color: [r * 1.4, gg * 0.72, b * 0.32, 0.10 + heat * 0.20],
        options: [1, 0, 0, 0],
      });
    }
    if (failed.has(f.id)) {
      const size = g.radius * 4.2;
      normal.push({
        model: composeModel(f.position.x, 0.09, f.position.z, 0, size, 1, size),
        color: [1, 0.12, 0.05, 0.92],
        options: [0, 0, 0, 0],
      });
    }
    if (selectedId === f.id) {
      const size = g.radius * 4.8;
      normal.push({
        model: composeModel(f.position.x, 0.1, f.position.z, 0, size, 1, size),
        color: [1, 0.78, 0.2, 0.95],
        options: [0, 0, 0, 0],
      });
    }
  });

  data.points.forEach((p) => {
    let hottestX = 0;
    let hottestZ = 1;
    let hottestT = -1;
    data.forgings.forEach((f, i) => {
      const t = tempsC[i] ?? f.dischargeTempC;
      if (t > hottestT) {
        hottestT = t;
        hottestX = f.position.x;
        hottestZ = f.position.z;
      }
    });
    let dx = 0.4;
    let dz = 1;
    if (hottestT >= 0) {
      dx = p.x - hottestX;
      dz = p.z - hottestZ;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
    }
    normal.push({
      model: composeModel(p.x + dx * 0.85, 0.08, p.z + dz * 0.85, Math.atan2(dx, dz), 0.72, 1, 2.35),
      color: [0.01, 0.012, 0.02, 0.48],
      options: [2, 0, 0, 0],
    });
    normal.push({
      model: composeModel(p.x, 0.11, p.z, 0, 1.35, 1, 1.35),
      color: [0.1, 0.9, 0.82, 0.8],
      options: [0, 0, 0, 0],
    });
  });

  return { normal, glow };
};

export const packOverlay = (items: OverlayInstance[]): Float32Array => {
  const out = new Float32Array(items.length * 24);
  items.forEach((item, i) => {
    out.set(item.model, i * 24);
    out.set(item.color, i * 24 + 16);
    out.set(item.options, i * 24 + 20);
  });
  return out;
};
