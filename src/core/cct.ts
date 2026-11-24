export interface CctCurve {
  steel: string;
  austenitizeC: number;
  criticalRate85CPerMin: number;
  targetHardness: [number, number];
  phases: { rateCPerMin: number; structure: string; hardness: [number, number] }[];
  diagram: { tSec: number; tempC: number; label?: string }[][];
}

const curve = (points: [number, number, string?][]): { tSec: number; tempC: number; label?: string }[] =>
  points.map(([tSec, tempC, label]) => ({ tSec, tempC, label }));

export const CCT_LIBRARY: Record<string, CctCurve> = {
  Q355E: {
    steel: 'Q355E',
    austenitizeC: 920,
    criticalRate85CPerMin: 3.6,
    targetHardness: [145, 185],
    phases: [
      { rateCPerMin: 18, structure: '贝氏体+铁素体', hardness: [180, 220] },
      { rateCPerMin: 3.6, structure: '细珠光体+铁素体', hardness: [145, 185] },
      { rateCPerMin: 1.2, structure: '粗珠光体+铁素体', hardness: [120, 150] },
    ],
    diagram: [
      curve([[0, 850], [120, 760], [500, 620, 'F开始'], [1400, 560, 'P开始'], [2600, 480, '转变结束']]),
      curve([[0, 850], [300, 720], [1200, 610], [3600, 520]]),
      curve([[0, 850], [600, 700], [2400, 620], [7200, 500]]),
    ],
  },
  '42CrMo4': {
    steel: '42CrMo4',
    austenitizeC: 850,
    criticalRate85CPerMin: 72,
    targetHardness: [260, 320],
    phases: [
      { rateCPerMin: 900, structure: '马氏体', hardness: [500, 560] },
      { rateCPerMin: 120, structure: '贝氏体+马氏体', hardness: [320, 420] },
      { rateCPerMin: 72, structure: '贝氏体临界', hardness: [260, 320] },
      { rateCPerMin: 18, structure: '珠光体+铁素体', hardness: [190, 240] },
    ],
    diagram: [
      curve([[0, 830], [40, 600], [120, 420, 'Ms'], [500, 200]]),
      curve([[0, 830], [180, 620, 'B开始'], [900, 430], [2200, 300]]),
      curve([[0, 830], [900, 650, 'P开始'], [3600, 560], [9000, 420]]),
    ],
  },
  '45#': {
    steel: '45#',
    austenitizeC: 840,
    criticalRate85CPerMin: 18,
    targetHardness: [170, 217],
    phases: [
      { rateCPerMin: 240, structure: '马氏体', hardness: [450, 520] },
      { rateCPerMin: 42, structure: '索氏体', hardness: [220, 280] },
      { rateCPerMin: 18, structure: '细珠光体', hardness: [170, 217] },
      { rateCPerMin: 6, structure: '粗珠光体+铁素体', hardness: [140, 180] },
    ],
    diagram: [
      curve([[0, 820], [80, 550], [260, 350, 'Ms']]),
      curve([[0, 820], [300, 600], [1200, 500]]),
      curve([[0, 820], [900, 650], [5000, 520]]),
    ],
  },
};

export const getCct = (steel: string): CctCurve => CCT_LIBRARY[steel] ?? CCT_LIBRARY.Q355E;

export const judgeCooling = (steel: string, rate85CPerS: number): {
  pass: boolean;
  requiredCPerS: number;
  label: string;
  targetHardness: [number, number];
} => {
  const cct = getCct(steel);
  const requiredCPerS = cct.criticalRate85CPerMin / 60;
  const pass = rate85CPerS >= requiredCPerS;
  const match = [...cct.phases].reverse().find((p) => rate85CPerS * 60 >= p.rateCPerMin);
  return {
    pass,
    requiredCPerS,
    label: match?.structure ?? '极慢冷：粗大珠光体/铁素体风险',
    targetHardness: cct.targetHardness,
  };
};
