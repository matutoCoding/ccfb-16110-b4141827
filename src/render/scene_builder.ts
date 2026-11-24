import { geoInfo } from '../core/geometry';
import { composeModel, type Mat4 } from './mat4';
import { createAnnulus, createCube, createCylinder, type MeshData } from './meshes';
import type { AppData, ID } from '../core/types';

export interface RenderInstance {
  model: Mat4;
  color: [number, number, number, number];
  temp: number;
  rough: number;
  metal: number;
  emissive: number;
  outline: number;
}

export interface SceneBatch {
  key: string;
  mesh?: MeshData;
  instances: RenderInstance[];
}

export interface Pickable {
  id: ID;
  kind: 'forging' | 'object' | 'point';
  x: number;
  z: number;
  radius?: number;
  width?: number;
  depth?: number;
  rotation?: number;
}

export interface BuildSceneOptions {
  tempsC: Float32Array;
  failed: Set<ID>;
  selectedId?: ID;
  night: boolean;
  showMarkers: boolean;
}

const inst = (
  model: Mat4,
  color: [number, number, number, number],
  temp = 35,
  rough = 0.7,
  metal = 0.1,
  emissive = 0,
  outline = 0,
): RenderInstance => ({ model, color, temp, rough, metal, emissive, outline });

const shaftMesh = (): MeshData => {
  const base = createCylinder(24);
  const vertices = new Float32Array(base.vertices);
  for (let i = 0; i < vertices.length; i += 6) {
    const x = vertices[i];
    const y = vertices[i + 1];
    const nx = vertices[i + 3];
    const ny = vertices[i + 4];
    vertices[i] = y - 0.5;
    vertices[i + 1] = x;
    vertices[i + 3] = ny;
    vertices[i + 4] = nx;
  }
  return { vertices, indices: base.indices };
};

export const buildScene = (data: AppData, opts: BuildSceneOptions): {
  batches: SceneBatch[];
  pickables: Pickable[];
} => {
  const cube: RenderInstance[] = [];
  const cylinder: RenderInstance[] = [];
  const shaft: RenderInstance[] = [];
  const annulusBatches = new Map<string, SceneBatch>();
  const pickables: Pickable[] = [];

  cube.push(inst(composeModel(0, -0.04, 0, 0, data.site.width, 0.08, data.site.depth), [0.20, 0.22, 0.25, 1], 38, 0.92, 0.02));

  for (const o of data.objects) {
    pickables.push({ id: o.id, kind: 'object', x: o.x, z: o.z, width: o.width, depth: o.depth, rotation: o.rotation ?? 0 });
    if (o.type === 'aisle') {
      cube.push(inst(composeModel(o.x, 0.005, o.z, o.rotation ?? 0, o.width, 0.025, o.depth), [0.34, 0.37, 0.42, 1], 42, 0.86));
      continue;
    }
    if (o.type === 'zone') {
      cube.push(inst(composeModel(o.x, 0.01, o.z, o.rotation ?? 0, o.width, 0.018, o.depth), [0.12, 0.35, 0.52, 0.7], 40, 0.8));
      continue;
    }
    if (o.type === 'screen') {
      const mat = o.material ?? 'steel';
      const color: [number, number, number] = mat === 'aluminum' ? [0.62, 0.66, 0.70] : mat === 'ceramic' ? [0.72, 0.66, 0.54] : mat === 'watercooled' ? [0.20, 0.34, 0.42] : [0.42, 0.45, 0.49];
      const metal = mat === 'ceramic' ? 0.05 : 0.72;
      cube.push(inst(composeModel(o.x, 0, o.z, o.rotation ?? 0, o.width, o.height, o.depth), [...color, 1], 45, 0.34, metal));
      cube.push(inst(composeModel(o.x, o.height, o.z, o.rotation ?? 0, o.width + 0.2, 0.12, o.depth + 0.18), [0.28, 0.30, 0.33, 1], 45, 0.4, 0.7));
      continue;
    }
    if (o.type === 'fan') {
      cylinder.push(inst(composeModel(o.x, 0, o.z, 0, 0.55, 0.22, 0.55), [0.25, 0.28, 0.31, 1], 42, 0.5, 0.6));
      cylinder.push(inst(composeModel(o.x, 0.2, o.z, 0, 0.16, 1.65, 0.16), [0.34, 0.37, 0.40, 1], 42, 0.45, 0.7));
      cube.push(inst(composeModel(o.x, 1.55, o.z, o.yaw ?? 0, 1.45, 1.05, 0.72), [0.18, 0.38, 0.56, 1], 42, 0.42, 0.45));
      cylinder.push(inst(composeModel(o.x, 2.05, o.z, o.yaw ?? 0, 0.72, 0.16, 0.72), [0.72, 0.76, 0.80, 1], 42, 0.3, 0.8));
      continue;
    }
    if (o.type === 'station') {
      cube.push(inst(composeModel(o.x, 0, o.z, o.rotation ?? 0, o.width, 2.45, o.depth), [0.25, 0.31, 0.38, 1], 42, 0.65, 0.25));
      cube.push(inst(composeModel(o.x, 2.45, o.z, o.rotation ?? 0, o.width + 0.4, 0.18, o.depth + 0.4), [0.16, 0.20, 0.25, 1], 42, 0.55, 0.35));
    }
  }

  data.points.forEach((p) => {
    pickables.push({ id: p.id, kind: 'point', x: p.x, z: p.z, radius: 0.55 });
    cube.push(inst(composeModel(p.x - 0.16, 0, p.z, 0, 0.16, 0.55, 0.2), [0.10, 0.12, 0.15, 1], 37, 0.8));
    cube.push(inst(composeModel(p.x + 0.16, 0, p.z, 0, 0.16, 0.55, 0.2), [0.10, 0.12, 0.15, 1], 37, 0.8));
    cylinder.push(inst(composeModel(p.x, 0.52, p.z, 0, 0.23, 0.72, 0.23), [0.12, 0.15, 0.19, 1], 37, 0.85));
    cylinder.push(inst(composeModel(p.x, 1.22, p.z, 0, 0.17, 0.22, 0.17), [0.20, 0.16, 0.14, 1], 37, 0.7));
    cylinder.push(inst(composeModel(p.x, 0, p.z, 0, 0.42, 0.08, 0.42), [0.10, 0.75, 0.72, 1], 37, 0.4, 0.2, 0, opts.selectedId === p.id ? 1 : 0));
  });

  data.forgings.forEach((f, i) => {
    const g = geoInfo(f.kind, f.dims);
    const temp = opts.tempsC[i] ?? f.dischargeTempC;
    const failed = opts.failed.has(f.id);
    const selected = opts.selectedId === f.id;
    const outline = failed || selected ? 1 : 0;
    pickables.push({ id: f.id, kind: 'forging', x: f.position.x, z: f.position.z, radius: g.radius * 1.08 });
    const color: [number, number, number, number] = selected ? [0.95, 0.72, 0.18, outline] : [0.16, 0.17, 0.19, outline];
    if (f.kind === 'shaft') {
      shaft.push(inst(composeModel(f.position.x, g.radius, f.position.z, f.rotation, g.footprintX, g.radius, g.radius), color, temp, 0.58, 0.78, 1, outline));
    } else {
      const d = f.dims;
      const outer = d.outerDiameter ?? 2.8;
      const inner = d.innerDiameter ?? outer * 0.78;
      const h = d.height ?? 0.55;
      const key = `annulus:${outer}:${inner}:${h}`;
      if (!annulusBatches.has(key)) {
        annulusBatches.set(key, { key, mesh: createAnnulus(outer / 2, inner / 2, h, 44), instances: [] });
      }
      annulusBatches.get(key)!.instances.push(inst(composeModel(f.position.x, 0, f.position.z, f.rotation, 1, 1, 1), color, temp, 0.62, 0.82, 1, outline));
    }
  });

  if (opts.showMarkers) {
    data.measurements.slice(0, 80).forEach((m) => {
      const f = data.forgings.find((x) => x.id === m.forgingId);
      if (!f) return;
      const g = geoInfo(f.kind, f.dims);
      const dev = m.measuredC - m.referenceC;
      const color: [number, number, number] = Math.abs(dev) < 20 ? [0.2, 0.85, 0.55] : dev > 0 ? [1, 0.45, 0.1] : [0.35, 0.62, 1];
      cube.push(inst(composeModel(f.position.x, g.height + 0.55, f.position.z, Math.PI / 4, 0.24, 0.24, 0.24), [...color, 1], m.measuredC, 0.35, 0.2, 1, 1));
    });
  }

  const batches: SceneBatch[] = [
    { key: 'cube', mesh: createCube(), instances: cube },
    { key: 'cylinder', mesh: createCylinder(28), instances: cylinder },
    { key: 'shaft', mesh: shaftMesh(), instances: shaft },
    ...annulusBatches.values(),
  ];
  return { batches, pickables };
};
