import type {
  AppData,
  Batch,
  Forging,
  ProcessRecord,
  SiteObject,
  SiteSpec,
  TempMeasurement,
  ExposurePoint,
} from '../core/types';

const DB_NAME = 'cooling-field-workbench';
const DB_VERSION = 1;
const STORE = 'documents';

let dbPromise: Promise<IDBDatabase> | null = null;

const openDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
};

const tx = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = run(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const idbGet = async <T>(key: string): Promise<T | undefined> =>
  tx('readonly', (store) => store.get(key) as IDBRequest<T | undefined>);

export const idbSet = async (key: string, value: unknown): Promise<void> => {
  await tx('readwrite', (store) => store.put(value, key));
};

export const idbClear = async (): Promise<void> => {
  await tx('readwrite', (store) => store.clear());
};

const empty: AppData = {
  site: { width: 120, depth: 54, ambientC: 36 },
  objects: [],
  points: [],
  batches: [],
  forgings: [],
  measurements: [],
  records: [],
};

export const loadAppData = async (): Promise<AppData> => {
  const [site, objects, points, batches, forgings, measurements, records] = await Promise.all([
    idbGet<SiteSpec>('site'),
    idbGet<SiteObject[]>('objects'),
    idbGet<ExposurePoint[]>('points'),
    idbGet<Batch[]>('batches'),
    idbGet<Forging[]>('forgings'),
    idbGet<TempMeasurement[]>('measurements'),
    idbGet<ProcessRecord[]>('records'),
  ]);
  return {
    site: site ?? empty.site,
    objects: objects ?? [],
    points: points ?? [],
    batches: batches ?? [],
    forgings: forgings ?? [],
    measurements: measurements ?? [],
    records: records ?? [],
  };
};

export const persist = {
  site: (site: SiteSpec) => idbSet('site', site),
  objects: (objects: SiteObject[]) => idbSet('objects', objects),
  points: (points: ExposurePoint[]) => idbSet('points', points),
  batches: (batches: Batch[]) => idbSet('batches', batches),
  forgings: (forgings: Forging[]) => idbSet('forgings', forgings),
  measurements: (measurements: TempMeasurement[]) => idbSet('measurements', measurements),
  records: (records: ProcessRecord[]) => idbSet('records', records),
};
