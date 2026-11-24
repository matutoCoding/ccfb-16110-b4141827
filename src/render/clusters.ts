import type { Mat4 } from './mat4';

export const CLUSTER_X = 16;
export const CLUSTER_Y = 9;
export const CLUSTER_Z = 24;
export const CLUSTER_COUNT = CLUSTER_X * CLUSTER_Y * CLUSTER_Z;

export interface CpuLight {
  x: number;
  y: number;
  z: number;
  range: number;
  r: number;
  g: number;
  b: number;
  intensity: number;
}

export interface ClusterData {
  lights: Float32Array;
  headers: Uint32Array;
  indices: Uint32Array;
  assignmentCount: number;
}

const transformViewZ = (view: Mat4, x: number, y: number, z: number): number =>
  view[2] * x + view[6] * y + view[10] * z + view[14];

export const buildClusters = (
  lights: CpuLight[],
  view: Mat4,
  viewProj: Mat4,
  aspect: number,
): ClusterData => {
  const buckets: number[][] = Array.from({ length: CLUSTER_COUNT }, () => []);
  const lightData = new Float32Array(Math.max(1, lights.length) * 8);

  lights.forEach((light, i) => {
    lightData.set([light.x, light.y, light.z, light.range, light.r, light.g, light.b, light.intensity], i * 8);
    const vz = transformViewZ(view, light.x, light.y, light.z);
    const depth = Math.max(0.5, -vz);
    const cx = viewProj[0] * light.x + viewProj[4] * light.y + viewProj[8] * light.z + viewProj[12];
    const cy = viewProj[1] * light.x + viewProj[5] * light.y + viewProj[9] * light.z + viewProj[13];
    const cw = viewProj[3] * light.x + viewProj[7] * light.y + viewProj[11] * light.z + viewProj[15];
    const ndcX = cx / cw;
    const ndcY = cy / cw;
    const centerX = (ndcX * 0.5 + 0.5) * CLUSTER_X;
    const centerY = (0.5 - ndcY * 0.5) * CLUSTER_Y;
    const proj5 = 1 / Math.tan((55 * Math.PI) / 360);
    const radiusY = (light.range * proj5 * CLUSTER_Y) / (2 * depth);
    const radiusX = (light.range * proj5 * CLUSTER_X) / (2 * depth * aspect);
    const x0 = Math.max(0, Math.floor(centerX - radiusX));
    const x1 = Math.min(CLUSTER_X - 1, Math.ceil(centerX + radiusX));
    const y0 = Math.max(0, Math.floor(centerY - radiusY));
    const y1 = Math.min(CLUSTER_Y - 1, Math.ceil(centerY + radiusY));
    const z0 = 2;
    const z1 = 180;
    const zn0 = Math.max(z0, depth - light.range);
    const zn1 = Math.min(z1, depth + light.range);
    const z0s = Math.max(0, Math.floor((Math.log(zn0 / z0) / Math.log(z1 / z0)) * CLUSTER_Z));
    const z1s = Math.min(CLUSTER_Z - 1, Math.ceil((Math.log(zn1 / z0) / Math.log(z1 / z0)) * CLUSTER_Z));

    for (let zz = z0s; zz <= z1s; zz++) {
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          buckets[(zz * CLUSTER_Y + yy) * CLUSTER_X + xx].push(i);
        }
      }
    }
  });

  const headers = new Uint32Array(CLUSTER_COUNT * 2);
  const total = buckets.reduce((sum, b) => sum + b.length, 0);
  const indices = new Uint32Array(Math.max(1, total));
  let offset = 0;
  buckets.forEach((bucket, i) => {
    headers[i * 2] = offset;
    headers[i * 2 + 1] = bucket.length;
    bucket.forEach((li) => {
      indices[offset++] = li;
    });
  });

  return { lights: lightData, headers, indices, assignmentCount: total };
};
