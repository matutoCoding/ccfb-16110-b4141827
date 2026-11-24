import { computeHeatmap } from '../core/exposure';
import { temperatureAt } from '../core/thermal';
import { uid } from '../core/format';
import { WebGpuStage } from '../render/renderer';
import { store } from '../state/store';
import { scheduleSimulation } from '../state/simulation_actions';
import { paintHeatmap } from './heatmap_canvas';
import { toast } from './toast';
import { h } from './dom';

declare global {
  interface Window {
    __stage?: WebGpuStage;
  }
}

type DragState = {
  mode: 'orbit' | 'pan' | 'drag';
  id?: string;
  kind?: 'forging' | 'object' | 'point';
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
};

export const mountViewport = (canvas: HTMLCanvasElement): (() => void) => {
  const stage = new WebGpuStage(canvas);
  window.__stage = stage;
  let drag: DragState | null = null;
  let raf = 0;
  let last = performance.now();
  let lastHeat = 0;
  let heatCanvas: HTMLCanvasElement | null = null;
  let lastFpsEmit = 0;

  void stage.init().then((ok) => {
    store.webgpu = ok;
    if (!ok) {
      const parent = canvas.parentElement!;
      parent.append(
        h('div', { class: 'unsupported' },
          h('div', { class: 'card' },
            h('h2', {}, '当前浏览器没有启用 WebGPU'),
            h('p', {}, '请使用 Chrome/Edge 120+，并在 chrome://flags 中启用 WebGPU 与硬件加速。场地数据、IndexedDB 和物理复核仍可使用 pnpm verify:physics 验证。'),
          ),
        ),
      );
    }
  });

  const onDown = (e: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    const hit = stage.pick(x, y);
    const panButton = e.button === 1 || e.button === 2 || e.shiftKey;
    if (hit && e.button === 0 && !store.addPointMode && !panButton) {
      drag = { mode: 'drag', id: hit.id, kind: hit.kind, pointerId: e.pointerId, startX: x, startY: y, lastX: x, lastY: y, moved: false };
      store.select(hit.kind, hit.id);
      canvas.classList.add('dragging');
    } else {
      drag = { mode: panButton ? 'pan' : 'orbit', pointerId: e.pointerId, startX: x, startY: y, lastX: x, lastY: y, moved: false };
    }
    canvas.setPointerCapture(e.pointerId);
    void rect;
  };

  const onMove = (e: PointerEvent): void => {
    if (!drag) return;
    const dx = e.clientX - drag.lastX;
    const dy = e.clientY - drag.lastY;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 4) drag.moved = true;

    if (drag.mode === 'orbit') stage.camera.rotate(dx, dy);
    if (drag.mode === 'pan') stage.camera.pan(dx, dy);
    if (drag.mode === 'drag' && drag.id && drag.kind) {
      const p = stage.groundPoint(e.clientX, e.clientY);
      if (!p) return;
      p.x = Math.round(p.x * 10) / 10;
      p.z = Math.round(p.z * 10) / 10;
      if (drag.kind === 'forging') {
        const f = store.data.forgings.find((x) => x.id === drag!.id);
        if (f) f.position = p;
      } else if (drag.kind === 'object') {
        const o = store.data.objects.find((x) => x.id === drag!.id);
        if (o) {
          o.x = p.x;
          o.z = p.z;
        }
      } else {
        const point = store.data.points.find((x) => x.id === drag!.id);
        if (point) {
          point.x = p.x;
          point.z = p.z;
        }
      }
    }
  };

  const onUp = async (e: PointerEvent): Promise<void> => {
    if (!drag) return;
    const current = drag;
    drag = null;
    canvas.classList.remove('dragging');
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* noop */ }

    if (current.mode === 'drag' && current.moved && current.kind) {
      if (current.kind === 'forging') await store.save('forgings');
      if (current.kind === 'object') await store.save('objects');
      if (current.kind === 'point') await store.save('points');
      scheduleSimulation();
      return;
    }

    if (!current.moved && current.mode !== 'drag') {
      if (store.addPointMode) {
        const p = stage.groundPoint(e.clientX, e.clientY);
        if (p) {
          const point = { id: uid('point'), name: `新增测点 ${store.data.points.length + 1}`, x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10, height: 1.5, kind: 'aisle' as const };
          store.data.points.push(point);
          await store.save('points');
          store.select('point', point.id);
          toast('测点已放置，累计暴露将按时间轴计算');
        }
      } else {
        const hit = stage.pick(e.clientX, e.clientY);
        if (hit) store.select(hit.kind, hit.id);
        else store.select('object', undefined);
      }
    }
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    stage.camera.zoom(e.deltaY);
  };
  const onContext = (e: Event): void => e.preventDefault();
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && store.addPointMode) {
      store.addPointMode = false;
      store.emit('page');
    }
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContext);
  window.addEventListener('keydown', onKey);

  const unsubStore = store.subscribe((event) => {
    if (event === 'focus' && store.focusTarget) {
      stage.camera.target[0] = store.focusTarget.x;
      stage.camera.target[2] = store.focusTarget.z;
      stage.camera.distance = 38;
      stage.camera.pitch = 0.72;
    }
  });

  const frame = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (store.playing && store.result) {
      store.timeSec += dt * store.speed;
      if (store.timeSec >= store.result.durationSec) {
        store.timeSec = store.result.durationSec;
        store.playing = false;
      }
      store.emit('tick');
    }

    const n = store.data.forgings.length;
    const temps = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      temps[i] = store.result
        ? temperatureAt(store.result, i, store.timeSec, 'surface')
        : store.data.forgings[i].dischargeTempC;
    }
    const failed = new Set<string>();
    if (store.result) {
      for (const t of store.result.byId.values()) if (t.failed) failed.add(t.pieceId);
    }

    if (store.page === 'exposure' && store.showHeatmap && now - lastHeat > 420) {
      lastHeat = now;
      const grid = computeHeatmap({ site: store.data.site, objects: store.data.objects, forgings: store.data.forgings }, temps, 76, 36);
      heatCanvas = paintHeatmap(grid);
    }
    if (store.page !== 'exposure' || !store.showHeatmap) heatCanvas = null;

    stage.render({
      data: store.data,
      tempsC: temps,
      failed,
      selectedId: store.selectedId(),
      mode: store.viewMode,
      split: store.split,
      night: store.night,
      showMarkers: store.showMarkers,
      heatmapCanvas: heatCanvas,
    });

    if (now - lastFpsEmit > 800) {
      lastFpsEmit = now;
      store.fps = stage.fps;
      store.emit('fps');
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onContext);
    window.removeEventListener('keydown', onKey);
    unsubStore();
  };
};
