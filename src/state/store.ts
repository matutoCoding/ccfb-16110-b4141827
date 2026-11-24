import { persist } from '../db/database';
import type {
  AppData,
  ID,
  PageKey,
  ThermalResult,
  ViewMode,
} from '../core/types';

type Listener = (event?: string) => void;

class Store {
  data: AppData = {
    site: { width: 120, depth: 54, ambientC: 36 },
    objects: [],
    points: [],
    batches: [],
    forgings: [],
    measurements: [],
    records: [],
  };
  page: PageKey = 'site';
  selectedObjectId?: ID;
  selectedForgingId?: ID;
  selectedPointId?: ID;
  result: ThermalResult | null = null;
  resultBusy = false;
  timeSec = 2700;
  playing = false;
  speed = 300;
  viewMode: ViewMode = 'visible';
  split = false;
  night = false;
  showHeatmap = true;
  showMarkers = true;
  addPointMode = false;
  fps = 0;
  webgpu = true;
  focusTarget: { x: number; z: number; nonce: number } | null = null;
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(event?: string): void {
    this.listeners.forEach((fn) => fn(event));
  }

  setData(data: AppData): void {
    this.data = data;
    this.emit('data');
  }

  async save<K extends keyof AppData>(key: K): Promise<void> {
    const value = this.data[key];
    await (persist[key as keyof typeof persist] as (v: unknown) => Promise<void>)(value);
    this.emit('persist');
  }

  async mutateCollection<K extends keyof AppData>(key: K, value: AppData[K]): Promise<void> {
    this.data[key] = value;
    await this.save(key);
    this.emit('data');
  }

  select(kind: 'object' | 'forging' | 'point', id?: ID): void {
    this.selectedObjectId = kind === 'object' ? id : undefined;
    this.selectedForgingId = kind === 'forging' ? id : undefined;
    this.selectedPointId = kind === 'point' ? id : undefined;
    this.emit('selection');
  }

  selectedId(): ID | undefined {
    return this.selectedForgingId ?? this.selectedObjectId ?? this.selectedPointId;
  }

  setPage(page: PageKey): void {
    this.page = page;
    if (page !== 'exposure') this.addPointMode = false;
    this.emit('page');
  }

  requestFocus(x: number, z: number): void {
    this.focusTarget = { x, z, nonce: Date.now() };
    this.emit('focus');
  }
}

export const store = new Store();
