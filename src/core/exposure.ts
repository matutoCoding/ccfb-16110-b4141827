import { occlusionByScreens } from './environment';
import { geoInfo } from './geometry';
import type { AppData, ExposurePoint, Forging, SiteObject } from './types';

const SIGMA = 5.670374419e-8;

export interface FluxInput {
  forgings: Forging[];
  tempC: Float32Array | number[];
  objects: SiteObject[];
  ambientC: number;
}

export const radiantFluxAt = (
  x: number,
  z: number,
  height: number,
  input: FluxInput,
): number => {
  const screens = input.objects.filter((o) => o.type === 'screen');
  const ak = input.ambientC + 273.15;
  let flux = 0;

  for (let i = 0; i < input.forgings.length; i++) {
    const f = input.forgings[i];
    const g = geoInfo(f.kind, f.dims);
    const sourceY = Math.max(0.18, g.height * 0.55);
    const dx = x - f.position.x;
    const dz = z - f.position.z;
    const dy = height - sourceY;
    const horizontal = Math.hypot(dx, dz);
    const r = Math.hypot(dx, dz, dy);
    if (r < 0.2) continue;
    const maxR = 18 + g.radius * 2;
    if (r > maxR) continue;

    const visible = occlusionByScreens(
      { x: f.position.x, z: f.position.z, y: sourceY },
      { x, z, y: height },
      screens,
    );
    if (visible <= 0.01) continue;

    const tk = input.tempC[i] + 273.15;
    const viewFactor = Math.min(0.42, (g.area * visible) / (4 * Math.PI * r * r));
    const receiverCos = 0.38 + 0.62 * Math.min(1, horizontal / r);
    flux += 0.82 * SIGMA * Math.max(0, tk ** 4 - ak ** 4) * viewFactor * receiverCos;
  }
  return flux;
};

export const EXPOSURE_LEVELS = [
  { value: 1000, label: '注意 1.0 kW/m²', color: '#facc15' },
  { value: 2500, label: '危险 2.5 kW/m²', color: '#f97316' },
  { value: 5000, label: '禁入 5.0 kW/m²', color: '#ef4444' },
];

export interface HeatmapGrid {
  nx: number;
  nz: number;
  width: number;
  depth: number;
  values: Float32Array;
  max: number;
}

export const computeHeatmap = (
  data: Pick<AppData, 'site' | 'objects' | 'forgings'>,
  tempC: Float32Array | number[],
  nx = 78,
  nz = 38,
  height = 1.2,
): HeatmapGrid => {
  const values = new Float32Array(nx * nz);
  const input: FluxInput = {
    forgings: data.forgings,
    tempC,
    objects: data.objects,
    ambientC: data.site.ambientC,
  };
  let max = 0;
  for (let iz = 0; iz < nz; iz++) {
    const z = -data.site.depth / 2 + ((iz + 0.5) / nz) * data.site.depth;
    for (let ix = 0; ix < nx; ix++) {
      const x = -data.site.width / 2 + ((ix + 0.5) / nx) * data.site.width;
      const q = radiantFluxAt(x, z, height, input);
      values[iz * nx + ix] = q;
      if (q > max) max = q;
    }
  }
  return { nx, nz, width: data.site.width, depth: data.site.depth, values, max };
};

export interface PointExposureTimeline {
  point: ExposurePoint;
  flux: number[];
  doseKjm2: number[];
  overSec: number[];
  maxFlux: number;
  finalDose: number;
  totalOverSec: number;
}

export const exposureTimeline = (
  point: ExposurePoint,
  data: Pick<AppData, 'site' | 'objects' | 'forgings'>,
  getTempC: (pieceIndex: number, timeSec: number) => number,
  times: Float32Array,
  threshold = 1000,
): PointExposureTimeline => {
  const flux: number[] = [];
  const doseKjm2: number[] = [];
  const overSec: number[] = [];
  let dose = 0;
  let over = 0;
  let maxFlux = 0;

  for (let f = 0; f < times.length; f++) {
    const temps = data.forgings.map((_, i) => getTempC(i, times[f]));
    const q = radiantFluxAt(point.x, point.z, point.height, {
      forgings: data.forgings,
      tempC: temps,
      objects: data.objects,
      ambientC: data.site.ambientC,
    });
    if (f > 0) {
      const dt = times[f] - times[f - 1];
      dose += (Math.max(0, q - 350) * dt) / 1000;
      if (q >= threshold) over += dt;
    }
    flux.push(q);
    doseKjm2.push(dose);
    overSec.push(over);
    maxFlux = Math.max(maxFlux, q);
  }
  return { point, flux, doseKjm2, overSec, maxFlux, finalDose: dose, totalOverSec: over };
};
