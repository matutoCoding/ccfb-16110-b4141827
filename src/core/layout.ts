import { geoInfo } from './geometry';
import type { Dimensions, LayoutPattern, ShapeKind } from './types';

export interface LayoutArea {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface LaidPosition {
  x: number;
  z: number;
  row: number;
  col: number;
  rotation: number;
}

export const defaultCoolingArea = (siteWidth: number, siteDepth: number): LayoutArea => ({
  minX: -siteWidth / 2 + 7,
  maxX: siteWidth / 2 - 7,
  minZ: -siteDepth / 2 + 6,
  maxZ: siteDepth / 2 - 8,
});

export const autoLayout = (
  count: number,
  kind: ShapeKind,
  dims: Dimensions,
  spacingX: number,
  spacingZ: number,
  pattern: LayoutPattern,
  area: LayoutArea,
): LaidPosition[] => {
  const geo = geoInfo(kind, dims);
  const gapX = Math.max(spacingX, geo.footprintX + 0.45);
  const gapZ = Math.max(spacingZ, geo.footprintZ + 0.45);
  const width = area.maxX - area.minX;
  const height = area.maxZ - area.minZ;
  const centerX = (area.minX + area.maxX) / 2;
  const centerZ = (area.minZ + area.maxZ) / 2;

  if (pattern === 'ring') {
    const out: LaidPosition[] = [];
    let ring = 0;
    while (out.length < count) {
      const radius = Math.max(geo.radius + 1.2, ring * gapX * 0.92 + gapX * 0.55);
      const circumference = 2 * Math.PI * radius;
      const perRing = Math.max(6, Math.floor(circumference / gapX));
      for (let i = 0; i < perRing && out.length < count; i++) {
        const a = (i / perRing) * Math.PI * 2 + ring * 0.17;
        out.push({
          x: centerX + Math.cos(a) * radius,
          z: centerZ + Math.sin(a) * radius,
          row: ring,
          col: i,
          rotation: -a + Math.PI / 2,
        });
      }
      ring++;
    }
    return out;
  }

  const cols = Math.max(1, Math.floor((width + gapX * 0.2) / gapX));
  const rows = Math.ceil(count / cols);
  const startX = centerX - ((cols - 1) * gapX) / 2;
  const startZ = centerZ - ((rows - 1) * gapZ) / 2;
  const out: LaidPosition[] = [];

  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const offset = pattern === 'staggered' && row % 2 ? gapX / 2 : 0;
    let x = startX + col * gapX + offset;
    if (x > area.maxX - geo.radius) x = area.maxX - geo.radius;
    out.push({
      x,
      z: startZ + row * gapZ,
      row,
      col,
      rotation: kind === 'shaft' ? 0 : 0,
    });
  }
  return out;
};
