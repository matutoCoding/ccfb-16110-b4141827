export type ID = string;
export type ShapeKind = 'flange' | 'ring' | 'shaft';
export type PageKey = 'site' | 'batches' | 'simulation' | 'exposure' | 'records';
export type ViewMode = 'visible' | 'thermal';

export interface Vec2 {
  x: number;
  z: number;
}

export interface Dimensions {
  outerDiameter?: number;
  innerDiameter?: number;
  height?: number;
  diameter?: number;
  length?: number;
}

export interface SiteSpec {
  width: number;
  depth: number;
  ambientC: number;
}

export type SiteObjectType = 'screen' | 'fan' | 'aisle' | 'station' | 'zone';
export type ScreenMaterial = 'aluminum' | 'steel' | 'ceramic' | 'watercooled';

export interface SiteObject {
  id: ID;
  type: SiteObjectType;
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  rotation?: number;
  material?: ScreenMaterial;
  emissivity?: number;
  yaw?: number;
  capacity?: number;
}

export interface Forging {
  id: ID;
  batchId: ID;
  code: string;
  kind: ShapeKind;
  steel: string;
  dims: Required<Pick<Dimensions, 'height'>> & Dimensions;
  dischargeTempC: number;
  dischargeAt: string;
  position: Vec2;
  rotation: number;
  row?: number;
  col?: number;
}

export type LayoutPattern = 'grid' | 'staggered' | 'ring';

export interface Batch {
  id: ID;
  code: string;
  steel: string;
  kind: ShapeKind;
  dims: Dimensions;
  count: number;
  spacingX: number;
  spacingZ: number;
  pattern: LayoutPattern;
  dischargeTempC: number;
  dischargeAt: string;
  createdAt: string;
  archived?: boolean;
  note?: string;
}

export interface TempMeasurement {
  id: ID;
  batchId: ID;
  forgingId?: ID;
  code?: string;
  offsetSec: number;
  measuredC: number;
  referenceC: number;
  probe: string;
  at: string;
}

export interface HardnessTest {
  id: ID;
  forgingId?: ID;
  code: string;
  x: number;
  z: number;
  hb: number;
  pass: boolean;
}

export interface CurveSummary {
  times: number[];
  avgC: number[];
  coreC?: number[];
  surfaceC?: number[];
  rate85?: number;
  minRate?: number;
  result?: 'pass' | 'fail';
}

export interface ProcessRecord {
  id: ID;
  batchId: ID;
  batchCode: string;
  steel: string;
  kind: ShapeKind;
  createdAt: string;
  layoutName: string;
  spacingX: number;
  spacingZ: number;
  layoutSnapshot: { x: number; z: number; code: string }[];
  summary: {
    durationSec: number;
    minRate85: number;
    failedCount: number;
    maxTempC: number;
    note: string;
  };
  hardness: HardnessTest[];
  historyCurve?: CurveSummary;
}

export interface ExposurePoint {
  id: ID;
  name: string;
  x: number;
  z: number;
  height: number;
  kind: 'aisle' | 'station';
}

export interface ExposureSample {
  fluxWm2: number;
  airC: number;
  doseKjm2: number;
  overSec: number;
}

export interface AppData {
  site: SiteSpec;
  objects: SiteObject[];
  points: ExposurePoint[];
  batches: Batch[];
  forgings: Forging[];
  measurements: TempMeasurement[];
  records: ProcessRecord[];
}

export interface ThermalSample {
  t: number;
  surfaceC: number;
  coreC: number;
  avgC: number;
  rateCPerS: number;
}

export interface Trajectory {
  pieceId: ID;
  samples: ThermalSample[];
  rate85: number;
  minRate: number;
  failed: boolean;
  suggestedSpacing?: number;
  target?: Vec2;
}

export interface ThermalResult {
  durationSec: number;
  sampleSec: number;
  byId: Map<ID, Trajectory>;
  times: Float32Array;
  surface: Float32Array;
  core: Float32Array;
  avg: Float32Array;
  rates: Float32Array;
  pieceIds: ID[];
}
