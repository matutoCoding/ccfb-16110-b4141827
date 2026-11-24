import { simulateThermal } from '../core/thermal';
import { store } from './store';

let timer: ReturnType<typeof setTimeout> | null = null;

export const runSimulation = async (): Promise<void> => {
  if (store.resultBusy) return;
  store.resultBusy = true;
  store.emit('busy');
  await new Promise((resolve) => setTimeout(resolve, 30));
  try {
    store.result = simulateThermal(store.data.forgings, {
      objects: store.data.objects,
      ambientC: store.data.site.ambientC,
      durationSec: 36_000,
      sampleSec: 60,
      dt: 5,
    });
    if (store.timeSec > store.result.durationSec) store.timeSec = store.result.durationSec;
  } finally {
    store.resultBusy = false;
    store.emit('result');
  }
};

export const scheduleSimulation = (delay = 650): void => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    void runSimulation();
  }, delay);
};

export const ensureSimulation = async (): Promise<void> => {
  if (!store.result && !store.resultBusy) await runSimulation();
};
