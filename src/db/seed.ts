import { autoLayout, defaultCoolingArea } from '../core/layout';
import { simulateThermal } from '../core/thermal';
import type {
  AppData,
  Batch,
  Forging,
  HardnessTest,
  ProcessRecord,
  TempMeasurement,
} from '../core/types';
import { loadAppData, persist } from './database';

const mulberry32 = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const nowIso = () => new Date().toISOString();

export const buildSeedData = (): AppData => {
  const rand = mulberry32(16110);
  const dischargeAt = new Date(Date.now() - 45 * 60_000).toISOString();
  const site: AppData['site'] = { width: 120, depth: 54, ambientC: 36 };

  const objects: AppData['objects'] = [
    { id: 'aisle-main', type: 'aisle', name: '主过道', x: 0, z: 20.2, width: 112, depth: 4.2, height: 0.02 },
    { id: 'screen-l', type: 'screen', name: '左侧隔热屏', x: -24, z: 14.7, width: 22, depth: 0.24, height: 2.6, material: 'aluminum', rotation: 0 },
    { id: 'screen-r', type: 'screen', name: '右侧隔热屏', x: 24, z: 14.7, width: 22, depth: 0.24, height: 2.6, material: 'aluminum', rotation: 0 },
    { id: 'screen-side', type: 'screen', name: '西侧隔热屏', x: -53.5, z: -2, width: 28, depth: 0.24, height: 2.2, material: 'ceramic', rotation: Math.PI / 2 },
    { id: 'fan-1', type: 'fan', name: '1号风机', x: -42, z: 16.8, width: 1.4, depth: 1.4, height: 2.2, yaw: 0 },
    { id: 'fan-2', type: 'fan', name: '2号风机', x: 0, z: 16.8, width: 1.4, depth: 1.4, height: 2.2, yaw: 0 },
    { id: 'fan-3', type: 'fan', name: '3号风机', x: 42, z: 16.8, width: 1.4, depth: 1.4, height: 2.2, yaw: 0 },
    { id: 'station-1', type: 'station', name: '测温工位', x: -38, z: 23.4, width: 8, depth: 3.2, height: 2.5 },
    { id: 'station-2', type: 'station', name: '巡检休息点', x: 0, z: 23.4, width: 8, depth: 3.2, height: 2.5 },
    { id: 'station-3', type: 'station', name: '硬度检验工位', x: 38, z: 23.4, width: 8, depth: 3.2, height: 2.5 },
  ];

  const points: AppData['points'] = [
    { id: 'point-a1', name: '过道西测点', x: -30, z: 19.4, height: 1.5, kind: 'aisle' },
    { id: 'point-a2', name: '过道中央测点', x: 0, z: 19.4, height: 1.5, kind: 'aisle' },
    { id: 'point-a3', name: '过道东测点', x: 30, z: 19.4, height: 1.5, kind: 'aisle' },
    { id: 'point-s1', name: '测温工位测点', x: -38, z: 22.6, height: 1.5, kind: 'station' },
    { id: 'point-s2', name: '检验工位测点', x: 38, z: 22.6, height: 1.5, kind: 'station' },
  ];

  const batch: Batch = {
    id: 'batch-demo-200',
    code: 'FF-2511-200',
    steel: 'Q355E',
    kind: 'flange',
    dims: { outerDiameter: 2.8, innerDiameter: 2.18, height: 0.55 },
    count: 200,
    spacingX: 3.28,
    spacingZ: 3.28,
    pattern: 'grid',
    dischargeTempC: 830,
    dischargeAt,
    createdAt: nowIso(),
    note: '风电法兰批次，密集码放，红外枪与硬度记录已导入',
  };

  const area = defaultCoolingArea(site.width, site.depth);
  const positions = autoLayout(200, batch.kind, batch.dims, batch.spacingX, batch.spacingZ, batch.pattern, area);
  const forgings: Forging[] = positions.map((p, i) => ({
    id: `seed-f-${String(i + 1).padStart(3, '0')}`,
    batchId: batch.id,
    code: `FF-2511-${String(i + 1).padStart(3, '0')}`,
    kind: batch.kind,
    steel: batch.steel,
    dims: { ...batch.dims, height: batch.dims.height ?? 0.55 },
    dischargeTempC: batch.dischargeTempC,
    dischargeAt,
    position: { x: p.x, z: p.z },
    rotation: p.rotation,
    row: p.row,
    col: p.col,
  }));

  const result = simulateThermal(forgings, { objects, ambientC: site.ambientC, durationSec: 28_800, sampleSec: 60 });
  const measurements: TempMeasurement[] = [];
  for (let k = 0; k < 42; k++) {
    const idx = Math.floor(rand() * forgings.length);
    const f = forgings[idx];
    const tr = result.byId.get(f.id);
    const sampleIndex = Math.min(tr!.samples.length - 1, Math.floor(2 + rand() * 180));
    const s = tr!.samples[sampleIndex];
    const systematic = k % 5 === 0 ? 24 : -14;
    const noise = (rand() - 0.5) * 34;
    const measuredC = Math.round(s.surfaceC * 0.985 + systematic + noise);
    measurements.push({
      id: `measure-${k + 1}`,
      batchId: batch.id,
      forgingId: f.id,
      code: f.code,
      offsetSec: s.t,
      measuredC,
      referenceC: Math.round(s.surfaceC),
      probe: k % 3 === 0 ? 'FLUKE-572-2 / ε=0.82' : '手持红外枪 / ε=0.95',
      at: new Date(new Date(dischargeAt).getTime() + s.t * 1000).toISOString(),
    });
  }

  const hardness: HardnessTest[] = [];
  for (let k = 0; k < 32; k++) {
    const idx = Math.floor((k / 32) * forgings.length);
    const f = forgings[idx];
    const tr = result.byId.get(f.id)!;
    const centerPenalty = Math.hypot(f.position.x / 52, (f.position.z + 1) / 18);
    const hb = Math.round(126 + tr.rate85 * 280 - centerPenalty * 8 + (rand() - 0.5) * 10);
    hardness.push({
      id: `hb-${k + 1}`,
      forgingId: f.id,
      code: f.code,
      x: f.position.x,
      z: f.position.z,
      hb,
      pass: hb >= 145,
    });
  }

  const failedCount = [...result.byId.values()].filter((t) => t.failed).length;
  const rates = [...result.byId.values()].map((t) => t.rate85);
  const currentRecord: ProcessRecord = {
    id: 'record-current',
    batchId: batch.id,
    batchCode: batch.code,
    steel: batch.steel,
    kind: batch.kind,
    createdAt: nowIso(),
    layoutName: '六排密集网格 + 东侧留缝',
    spacingX: batch.spacingX,
    spacingZ: batch.spacingZ,
    layoutSnapshot: forgings.map((f) => ({ x: f.position.x, z: f.position.z, code: f.code })),
    summary: {
      durationSec: 28_800,
      minRate85: Math.min(...rates),
      failedCount,
      maxTempC: batch.dischargeTempC,
      note: '中间码放圈冷速偏低，硬度低点与热辐射仿真重合',
    },
    hardness,
  };

  const records = [currentRecord, ...buildHistoryRecords(dischargeAt)];
  return { site, objects, points, batches: [batch], forgings, measurements, records };
};

const buildHistoryRecords = (dischargeAt: string): ProcessRecord[] => {
  const specs = [
    { code: 'FF-2509-064', spacing: 4.4, failed: 4, minRate: 0.071, note: '加宽间距后冷速刚过线' },
    { code: 'FF-2508-048', spacing: 5.4, failed: 0, minRate: 0.096, note: '疏码 + 风机引导，硬度合格' },
  ];
  return specs.map((s, idx) => ({
    id: `record-history-${idx + 1}`,
    batchId: `batch-history-${idx + 1}`,
    batchCode: s.code,
    steel: 'Q355E',
    kind: 'flange' as const,
    createdAt: new Date(Date.now() - (idx + 2) * 86_400_000).toISOString(),
    layoutName: idx === 0 ? '四排加宽网格' : '三排疏码 + 风机通道',
    spacingX: s.spacing,
    spacingZ: s.spacing,
    layoutSnapshot: [],
    summary: {
      durationSec: 28_800,
      minRate85: s.minRate,
      failedCount: s.failed,
      maxTempC: 820,
      note: s.note,
    },
    hardness: [],
    historyCurve: {
      times: Array.from({ length: 49 }, (_, i) => i * 600),
      avgC: Array.from({ length: 49 }, (_, i) => {
        const t = i * 600;
        return Math.round(36 + 784 * Math.exp(-t / (idx === 0 ? 5200 : 4200)));
      }),
      rate85: s.minRate,
      result: s.failed ? 'fail' : 'pass',
    },
  }));
};

export const seedIfEmpty = async (): Promise<AppData> => {
  const existing = await loadAppData();
  if (existing.forgings.length > 0 || existing.batches.length > 0) return existing;
  const data = buildSeedData();
  await Promise.all([
    persist.site(data.site),
    persist.objects(data.objects),
    persist.points(data.points),
    persist.batches(data.batches),
    persist.forgings(data.forgings),
    persist.measurements(data.measurements),
    persist.records(data.records),
  ]);
  return data;
};
