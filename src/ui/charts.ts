import { h } from './dom';

export interface ChartSeries {
  name: string;
  color: string;
  points: [number, number][];
  dashed?: boolean;
}

export const lineChart = (series: ChartSeries[], options: {
  xLabel?: string;
  yLabel?: string;
  height?: number;
  yMin?: number;
  yMax?: number;
  markers?: { x: number; color: string; label?: string }[];
} = {}): HTMLElement => {
  const width = 720;
  const height = options.height ?? 240;
  const margin = { top: 18, right: 18, bottom: 34, left: 48 };
  const iw = width - margin.left - margin.right;
  const ih = height - margin.top - margin.bottom;
  const all = series.flatMap((s) => s.points);
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const xMin = 0;
  const xMax = Math.max(1, ...xs);
  const yMin = options.yMin ?? Math.min(0, ...ys);
  const yMax = options.yMax ?? Math.max(100, ...ys) * 1.08;
  const x = (v: number) => margin.left + ((v - xMin) / (xMax - xMin)) * iw;
  const y = (v: number) => margin.top + ih - ((v - yMin) / (yMax - yMin)) * ih;
  const ticksY = 5;
  const ticksX = 6;
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');

  for (let i = 0; i <= ticksY; i++) {
    const value = yMin + ((yMax - yMin) * i) / ticksY;
    const yy = y(value);
    svg.appendChild(svgEl('line', { x1: margin.left, x2: width - margin.right, y1: yy, y2: yy, stroke: '#e2e8f0' }));
    const text = svgEl('text', { x: margin.left - 8, y: yy + 4, 'text-anchor': 'end', 'font-size': 14, fill: '#64748b' });
    text.textContent = value.toFixed(0);
    svg.appendChild(text);
  }
  for (let i = 0; i <= ticksX; i++) {
    const value = xMin + ((xMax - xMin) * i) / ticksX;
    const xx = x(value);
    const text = svgEl('text', { x: xx, y: height - 10, 'text-anchor': 'middle', 'font-size': 14, fill: '#64748b' });
    text.textContent = `${(value / 3600).toFixed(1)}h`;
    svg.appendChild(text);
  }

  for (const marker of options.markers ?? []) {
    const xx = x(marker.x);
    const line = svgEl('line', { x1: xx, x2: xx, y1: margin.top, y2: margin.top + ih, stroke: marker.color, 'stroke-width': 1.5, 'stroke-dasharray': '5 4' });
    line.dataset.currentMarker = 'true';
    svg.appendChild(line);
  }

  for (const s of series) {
    if (s.points.length < 2) continue;
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ');
    svg.appendChild(svgEl('path', {
      d, fill: 'none', stroke: s.color, 'stroke-width': 2.4,
      'stroke-dasharray': s.dashed ? '6 5' : undefined, 'stroke-linejoin': 'round',
    }));
  }

  const legend = h('div', { class: 'legend', style: 'display:flex;gap:16px;flex-wrap:wrap;margin-top:8px' });
  series.forEach((s) => legend.append(
    h('span', { style: 'display:inline-flex;align-items:center;gap:6px;color:#475569' },
      h('i', { style: `width:18px;height:3px;border-radius:2px;background:${s.color};display:inline-block` }), s.name),
  ));
  return h('div', { class: 'chart-card' }, h('div', { class: 'chart' }, svg), legend);
};

const svgEl = (tag: string, attrs: Record<string, unknown>): SVGElement => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined) el.setAttribute(k, String(v));
  }
  return el;
};

export const sparkBars = (values: number[], color = '#0f766e'): HTMLElement => {
  const max = Math.max(...values, 1);
  return h('div', { style: 'height:56px;display:flex;align-items:flex-end;gap:2px' },
    ...values.map((v) => h('i', {
      title: v.toFixed(2),
      style: `flex:1;height:${Math.max(4, (v / max) * 100)}%;background:${color};opacity:.72;border-radius:2px 2px 0 0`,
    })));
};
