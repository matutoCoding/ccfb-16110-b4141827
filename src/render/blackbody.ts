import { clamp } from '../core/format';

export const blackbodyRgb = (tempC: number): [number, number, number] => {
  const t = Math.max(1, (tempC + 273.15) / 100);
  let r = 255;
  let g = 255;
  let b = 255;
  if (t <= 66) {
    g = 99.4708025861 * Math.log(Math.max(t, 1)) - 161.1195681661;
    b = t >= 19 ? 138.5177312231 * Math.log(t - 10) - 305.0447927307 : 0;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  }
  return [clamp(r / 255, 0, 1), clamp(g / 255, 0, 1), clamp(b / 255, 0, 1)];
};

export const thermalPseudo = (tempC: number): [number, number, number] => {
  const x = clamp((tempC - 25) / 875, 0, 1);
  const stops: [number, [number, number, number]][] = [
    [0, [8, 13, 46]],
    [0.22, [13, 89, 242]],
    [0.42, [0, 217, 191]],
    [0.62, [242, 230, 38]],
    [0.82, [255, 82, 13]],
    [1, [255, 235, 209]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [x0, c0] = stops[i - 1];
      const [x1, c1] = stops[i];
      const t = (x - x0) / (x1 - x0);
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
    }
  }
  return [255, 255, 255];
};
