import type { Dimensions, Forging, ShapeKind, Vec2 } from './types';

export interface GeoInfo {
  volume: number;
  area: number;
  radius: number;
  height: number;
  footprintX: number;
  footprintZ: number;
  projectedArea: number;
  characteristic: number;
}

export const normalizeDims = (kind: ShapeKind, d: Dimensions): Required<Dimensions> => {
  if (kind === 'shaft') {
    const diameter = d.diameter ?? 0.8;
    const length = d.length ?? 4;
    return {
      outerDiameter: diameter,
      innerDiameter: 0,
      height: diameter,
      diameter,
      length,
    };
  }
  const outerDiameter = d.outerDiameter ?? 2.6;
  const innerDiameter = d.innerDiameter ?? outerDiameter * 0.78;
  const height = d.height ?? 0.45;
  return {
    outerDiameter,
    innerDiameter,
    height,
    diameter: outerDiameter,
    length: height,
  };
};

export const geoInfo = (kind: ShapeKind, raw: Dimensions): GeoInfo => {
  const d = normalizeDims(kind, raw);
  if (kind === 'shaft') {
    const r = d.diameter / 2;
    const volume = Math.PI * r * r * d.length;
    const area = 2 * Math.PI * r * d.length + 2 * Math.PI * r * r;
    return {
      volume,
      area,
      radius: r,
      height: d.diameter,
      footprintX: d.length,
      footprintZ: d.diameter,
      projectedArea: d.length * d.diameter,
      characteristic: r,
    };
  }

  const ro = d.outerDiameter / 2;
  const ri = d.innerDiameter / 2;
  const ringArea = Math.PI * (ro * ro - ri * ri);
  const volume = ringArea * d.height;
  const area = 2 * ringArea + 2 * Math.PI * ro * d.height + 2 * Math.PI * ri * d.height;
  return {
    volume,
    area,
    radius: ro,
    height: d.height,
    footprintX: d.outerDiameter,
    footprintZ: d.outerDiameter,
    projectedArea: d.outerDiameter * d.height + ringArea * 0.35,
    characteristic: Math.max(0.08, Math.min(ro - ri, d.height) / 2),
  };
};

export const forgingGeo = (f: Forging): GeoInfo => geoInfo(f.kind, f.dims);

export const rotateFootprint = (geo: GeoInfo, rotation: number): { x: number; z: number } => {
  const c = Math.abs(Math.cos(rotation));
  const s = Math.abs(Math.sin(rotation));
  return {
    x: geo.footprintX * c + geo.footprintZ * s,
    z: geo.footprintX * s + geo.footprintZ * c,
  };
};

export const distance2 = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
};
