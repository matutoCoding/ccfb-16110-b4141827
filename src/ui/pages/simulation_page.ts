import { judgeCooling } from '../../core/cct';
import { fmt, fmtTime, uid } from '../../core/format';
import { temperatureAt } from '../../core/thermal';
import type { Trajectory } from '../../core/types';
import { store } from '../../state/store';
import { runSimulation } from '../../state/simulation_actions';
import { badge, button, field, h, panelTitle, selectInput } from '../dom';
import { lineChart } from '../charts';
import { toast } from '../toast';

export const mountSimulationPage = (panel: HTMLElement, dock: HTMLElement): (() => void) => {
  let selectedId = store.selectedForgingId ?? store.data.forgings[0]?.id;
  if (selectedId) store.selectedForgingId = selectedId;

  const renderPanel = (): void => {
    panel.replaceChildren();
    const result = store.result;
    panel.append(panelTitle('冷却推演', '辐射、自然/强制对流、内部导热与相邻件可见角系数联合求解。'));

    panel.append(
      h('section', { class: 'section' },
        h('div', { class: 'btn-row' },
          button(result ? '重新推演 10 小时' : '开始冷却推演', () => void runSimulation(), 'primary'),
          resultBusyBadge(),
        ),
        h('p', { class: 'field-hint', style: 'margin-top:10px' }, '求解器：RK4，产品步长 5 秒；独立公式复核命令 pnpm verify:physics，三件全曲线误差 < 3%。'),
      ),
    );

    if (!result) {
      panel.append(h('div', { class: 'empty-state' }, h('div', { class: 'empty-icon' }), h('strong', {}, store.resultBusy ? '正在计算几百件温度场…' : '尚未生成推演结果'), h('p', {}, '点击“开始冷却推演”，通常 2–4 秒。')));
      return;
    }

    const trajectories = [...result.byId.values()];
    const failed = trajectories.filter((t) => t.failed);
    const rates = trajectories.map((t) => t.rate85).sort((a, b) => a - b);
    panel.append(
      h('section', { class: 'section' },
        h('h3', {}, '批次判定'),
        h('div', { class: 'grid-3' },
          stat('件数', String(trajectories.length)),
          stat('不合格', String(failed.length), failed.length ? 'bad' : 'ok'),
          stat('最低 t8/5 冷速', `${(rates[0] ?? 0).toFixed(4)} ℃/s`, failed.length ? 'bad' : 'ok'),
        ),
      ),
    );

    const f = store.data.forgings.find((x) => x.id === selectedId) ?? store.data.forgings[0];
    if (f) {
      selectedId = f.id;
      const tr = result.byId.get(f.id)!;
      const judge = judgeCooling(f.steel, tr.rate85);
      const chart = lineChart([
        { name: '表面', color: '#f97316', points: tr.samples.map((s) => [s.t, s.surfaceC]) },
        { name: '心部', color: '#2563eb', points: tr.samples.map((s) => [s.t, s.coreC]) },
        { name: '平均', color: '#0f766e', points: tr.samples.map((s) => [s.t, s.avgC]), dashed: true },
      ], { yLabel: '℃', markers: [{ x: store.timeSec, color: '#dc2626' }] });
      panel.append(
        h('section', { class: 'section' },
          h('h3', {}, `${f.code} 温度曲线`),
          h('div', { class: 'grid-3' },
            readout('表面 ℃', 'sim-surface'),
            readout('心部 ℃', 'sim-core'),
            readout('平均 ℃', 'sim-avg'),
          ),
          chart,
          h('div', { style: 'margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap' },
            badge(judge.pass ? 'CCT 冷速合格' : 'CCT 冷速不足', judge.pass ? 'ok' : 'bad'),
            h('span', { class: 'field-hint' }, `${judge.label}；临界 ${judge.requiredCPerS.toFixed(4)} ℃/s，实测 ${tr.rate85.toFixed(4)} ℃/s`),
          ),
        ),
      );
    }

    panel.append(renderFailList(failed.slice(0, 24)));
    panel.append(renderMeasurements());
    updateReadouts();
  };

  const renderDock = (): void => {
    dock.replaceChildren();
    const range = h('input', {
      type: 'range', min: '0', max: String(store.result?.durationSec ?? 36000), step: '60', value: String(store.timeSec),
      oninput: (e: Event) => {
        store.timeSec = Number((e.target as HTMLInputElement).value);
        updateReadouts();
      },
    }) as HTMLInputElement;
    const timeLabel = h('strong', { id: 'time-label', style: 'min-width:86px;font-variant-numeric:tabular-nums' }, fmtTime(store.timeSec));
    const playBtn = button(store.playing ? '暂停' : '播放', () => {
      if (!store.result) void runSimulation().then(() => { store.playing = true; });
      else store.playing = !store.playing;
      store.emit('tick');
    }, 'primary');

    const speeds = [60, 300, 1200, 3600];
    const speedGroup = h('div', { class: 'speed-group' },
      ...speeds.map((s) => button(`${s}×`, () => { store.speed = s; store.emit('view'); })),
    );
    speedGroup.querySelectorAll('.btn').forEach((btn, i) => btn.classList.toggle('active', speeds[i] === store.speed));

    dock.append(
      h('div', { class: 'timeline-row', style: 'grid-template-columns:auto 90px 1fr auto auto;gap:12px' },
        playBtn, timeLabel, range, speedGroup,
        h('div', { class: 'btn-row' },
          toggleBtn('可见光', store.viewMode === 'visible', () => { store.viewMode = 'visible'; store.emit('view'); }),
          toggleBtn('热像', store.viewMode === 'thermal', () => { store.viewMode = 'thermal'; store.emit('view'); }),
          toggleBtn('分屏', store.split, () => { store.split = !store.split; store.emit('view'); }),
          toggleBtn('夜班', store.night, () => { store.night = !store.night; store.emit('view'); }),
        ),
      ),
    );
  };

  const updateReadouts = (): void => {
    const result = store.result;
    const f = store.data.forgings.find((x) => x.id === selectedId);
    if (!result || !f) return;
    const i = result.pieceIds.indexOf(f.id);
    if (i < 0) return;
    setText('sim-surface', fmt(temperatureAt(result, i, store.timeSec, 'surface'), 1));
    setText('sim-core', fmt(temperatureAt(result, i, store.timeSec, 'core'), 1));
    setText('sim-avg', fmt(temperatureAt(result, i, store.timeSec, 'avg'), 1));
    setText('time-label', fmtTime(store.timeSec));
    const range = dock.querySelector('input[type=range]') as HTMLInputElement | null;
    if (range && document.activeElement !== range) range.value = String(Math.round(store.timeSec / 60) * 60);
  };

  const unsub = store.subscribe((event) => {
    if (event === 'result' || event === 'data' || event === 'selection' || event === 'page' || event === 'busy') {
      const next = store.selectedForgingId ?? selectedId;
      if (next) selectedId = next;
      renderDock();
      renderPanel();
    }
    if (event === 'tick' || event === 'fps') updateReadouts();
    if (event === 'view') renderDock();
  });

  renderDock();
  renderPanel();
  return unsub;
};

const stat = (label: string, value: string, tone: 'neutral' | 'ok' | 'bad' = 'neutral'): HTMLElement =>
  h('div', { class: 'metric-pill', style: 'display:grid;gap:4px;padding:12px' },
    h('span', { style: 'color:#64748b' }, label),
    h('b', { style: `font-size:20px;color:${tone === 'bad' ? '#dc2626' : tone === 'ok' ? '#15803d' : '#0f172a'}` }, value),
  );

const readout = (label: string, id: string): HTMLElement =>
  h('div', { class: 'metric-pill', style: 'display:grid;gap:2px' }, h('span', { style: 'color:#64748b' }, label), h('b', { id }, '—'));

const setText = (id: string, text: string): void => {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
};

const resultBusyBadge = (): HTMLElement =>
  store.resultBusy ? badge('求解中…', 'warn') : badge('RK4 · 5s', 'neutral');

const toggleBtn = (label: string, active: boolean, onclick: () => void): HTMLButtonElement =>
  h('button', { class: `btn ${active ? 'btn-primary' : ''}`, type: 'button', onclick }, label) as HTMLButtonElement;

const renderFailList = (items: Trajectory[]): HTMLElement =>
  h('section', { class: 'section' },
    h('h3', {}, `冷速不足与处置建议（前 ${items.length} 件）`),
    items.length === 0
      ? h('p', { class: 'field-hint' }, '当前没有低于 CCT 临界冷速的锻件。')
      : h('div', { class: 'list' }, ...items.map((tr) => {
          const f = store.data.forgings.find((x) => x.id === tr.pieceId)!;
          return h('div', { class: 'list-item' },
            h('div', { style: 'display:flex;justify-content:space-between;gap:8px' },
              h('strong', {}, f.code),
              badge(`${tr.rate85.toFixed(4)} ℃/s`, 'bad'),
            ),
            h('span', {}, `建议中心距 ≥ ${tr.suggestedSpacing?.toFixed(2) ?? '—'} m`),
            h('div', { class: 'btn-row', style: 'margin-top:8px' },
              button('查看曲线', () => { store.selectedForgingId = f.id; store.select('forging', f.id); store.emit('selection'); }),
              button('定位', () => store.requestFocus(f.position.x, f.position.z)),
              tr.target ? button('移至风机下风点', () => {
                f.position = { x: tr.target!.x, z: tr.target!.z };
                void store.save('forgings').then(() => { toast('已移到风机引导区，重新推演中'); void runSimulation(); });
              }, 'primary') : null,
            ),
          );
        })),
  );

const renderMeasurements = (): HTMLElement => {
  const fileInput = h('input', {
    type: 'file', accept: '.json,.csv', style: 'display:none',
    onchange: async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      const rows = parseMeasurementFile(file.name, text);
      for (const row of rows) {
        const forging = store.data.forgings.find((f) => f.code === row.code || f.id === row.forgingId);
        const offsetSec = Number(row.offsetSec ?? row.t ?? 0);
        const measuredC = Number(row.measuredC ?? row.tempC ?? row.c);
        if (!Number.isFinite(measuredC)) continue;
        const pieceIndex = forging ? store.result?.pieceIds.indexOf(forging.id) ?? -1 : -1;
        const referenceC = pieceIndex >= 0 && store.result
          ? temperatureAt(store.result, pieceIndex, offsetSec, 'surface')
          : measuredC;
        store.data.measurements.push({
          id: uid('measure'), batchId: forging?.batchId ?? store.data.batches[0]?.id ?? 'unknown',
          forgingId: forging?.id, code: row.code !== undefined ? String(row.code) : forging?.code, offsetSec, measuredC,
          referenceC: Math.round(referenceC), probe: row.probe !== undefined ? String(row.probe) : file.name, at: new Date().toISOString(),
        });
      }
      await store.save('measurements');
      store.emit('data');
      toast(`已导入 ${rows.length} 条测温记录`);
    },
  });
  return h('section', { class: 'section' },
    h('div', { style: 'display:flex;justify-content:space-between;gap:12px;align-items:center' },
      h('h3', { style: 'margin:0' }, `红外枪点温核对（${store.data.measurements.length} 条）`),
      h('label', { class: 'btn' }, '导入 JSON/CSV', fileInput),
    ),
    h('p', { class: 'field-hint' }, '字段：code,offsetSec,measuredC,probe；标记按实测温度进入热像伪彩。'),
    h('div', { class: 'table-wrap', style: 'max-height:280px' },
      h('table', { class: 'data-table' },
        h('thead', {}, h('tr', {}, h('th', {}, '件号'), h('th', {}, '时间'), h('th', {}, '实测'), h('th', {}, '参考'), h('th', {}, '偏差'), h('th', {}, '探头'))),
        h('tbody', {}, ...store.data.measurements.slice(0, 60).map((m) => {
          const dev = m.measuredC - m.referenceC;
          return h('tr', {},
            h('td', {}, m.code ?? '—'),
            h('td', {}, fmtTime(m.offsetSec)),
            h('td', {}, `${m.measuredC}℃`),
            h('td', {}, `${m.referenceC}℃`),
            h('td', {}, badge(`${dev > 0 ? '+' : ''}${dev}℃`, Math.abs(dev) <= 25 ? 'ok' : dev < 0 ? 'neutral' : 'warn')),
            h('td', {}, m.probe),
          );
        })),
      ),
    ),
  );
};

const parseMeasurementFile = (name: string, text: string): Record<string, unknown>[] => {
  if (name.toLowerCase().endsWith('.json')) {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : parsed.records ?? [];
  }
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(',').map((x) => x.trim());
  return lines.filter(Boolean).map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(headers.map((key, i) => [key.trim(), cells[i]?.trim()]));
  });
};
