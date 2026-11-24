import type { HeatmapGrid } from '../core/exposure';

const STOPS: [number, [number, number, number, number]][] = [
  [0, [15, 23, 42, 0]],
  [350, [34, 211, 238, 90]],
  [1000, [250, 204, 21, 145]],
  [2500, [249, 115, 22, 175]],
  [5000, [239, 68, 68, 205]],
  [9000, [127, 29, 29, 220]],
];

const colorFor = (v: number): [number, number, number, number] => {
  for (let i = 1; i < STOPS.length; i++) {
    if (v <= STOPS[i][0]) {
      const [v0, c0] = STOPS[i - 1];
      const [v1, c1] = STOPS[i];
      const t = (v - v0) / (v1 - v0);
      return c0.map((x, k) => Math.round(x + (c1[k] - x) * t)) as [number, number, number, number];
    }
  }
  return STOPS[STOPS.length - 1][1];
};

export const paintHeatmap = (grid: HeatmapGrid): HTMLCanvasElement => {
  const scale = 8;
  const canvas = document.createElement('canvas');
  canvas.width = grid.nx * scale;
  canvas.height = grid.nz * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let iz = 0; iz < grid.nz; iz++) {
    for (let ix = 0; ix < grid.nx; ix++) {
      const q = grid.values[iz * grid.nx + ix];
      const [r, g, b, a] = colorFor(q);
      ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
      ctx.fillRect(ix * scale, iz * scale, scale + 1, scale + 1);
    }
  }

  drawContours(ctx, grid, scale, 1000, 'rgba(250,204,21,.95)');
  drawContours(ctx, grid, scale, 2500, 'rgba(255,237,213,.96)');
  drawContours(ctx, grid, scale, 5000, 'rgba(254,202,202,1)');
  return canvas;
};

const drawContours = (
  ctx: CanvasRenderingContext2D,
  grid: HeatmapGrid,
  scale: number,
  level: number,
  stroke: string,
): void => {
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.beginPath();
  const at = (x: number, z: number) => grid.values[z * grid.nx + x];

  for (let z = 0; z < grid.nz - 1; z++) {
    for (let x = 0; x < grid.nx - 1; x++) {
      const p = [
        { x: x * scale, y: z * scale, v: at(x, z) },
        { x: (x + 1) * scale, y: z * scale, v: at(x + 1, z) },
        { x: (x + 1) * scale, y: (z + 1) * scale, v: at(x + 1, z + 1) },
        { x: x * scale, y: (z + 1) * scale, v: at(x, z + 1) },
      ];
      const intersections: { x: number; y: number }[] = [];
      for (let e = 0; e < 4; e++) {
        const a = p[e];
        const b = p[(e + 1) % 4];
        if ((a.v < level && b.v >= level) || (b.v < level && a.v >= level)) {
          const t = (level - a.v) / (b.v - a.v);
          intersections.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        }
      }
      if (intersections.length === 2) {
        ctx.moveTo(intersections[0].x, intersections[0].y);
        ctx.lineTo(intersections[1].x, intersections[1].y);
      } else if (intersections.length === 4) {
        ctx.moveTo(intersections[0].x, intersections[0].y);
        ctx.lineTo(intersections[1].x, intersections[1].y);
        ctx.moveTo(intersections[2].x, intersections[2].y);
        ctx.lineTo(intersections[3].x, intersections[3].y);
      }
    }
  }
  ctx.stroke();
};
