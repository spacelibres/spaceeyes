// Mechanism verified against NASA Eyes recovered TimeControls._createRatesMap.
const UNITS = [
  ["yr", 31536000],
  ["mth", 2592000],
  ["wk", 604800],
  ["day", 86400],
  ["hr", 3600],
  ["min", 60],
  ["sec", 1],
] as const;
const ANCHORS = [
  -94608000, -31536000, -6048000, -604800, -86400, -36000, -3600, -600, -60,
  -10, -1, 1, 10, 60, 600, 3600, 36000, 86400, 604800, 6048000, 31536000,
  94608000,
];
function finite(rate: number): void {
  if (!Number.isFinite(rate)) throw Error("invalid time rate");
}
function unit(rate: number) {
  return UNITS.find(([, seconds]) => Math.abs(rate) >= seconds) ?? UNITS[6];
}
function roundSigned(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}
function rounded(rate: number): number {
  const [, seconds] = unit(rate);
  return roundSigned(rate / seconds) * seconds;
}
function createRates(): readonly number[] {
  const rates: number[] = [];
  const reverse = ANCHORS.slice(0, 11),
    forward = ANCHORS.slice(11);
  reverse.forEach((start, i) => {
    const a = Math.round((i * 50) / 11),
      width = Math.round(((i + 1) * 50) / 11) - a,
      end = reverse[i + 1] ?? 0;
    for (let j = 0; j < width; j++) {
      const value = start + (j / width) * (end - start);
      rates.push(Math.floor(value > -1 ? -1 : rounded(value)));
    }
  });
  forward.forEach((start, i) => {
    const a = 50 + Math.round(i * 5),
      width = (i < 10 ? 50 + Math.round((i + 1) * 5) : 101) - a,
      end = forward[i + 1] ?? start;
    for (let j = 0; j < width; j++)
      rates.push(Math.floor(rounded(start + (j / width) * (end - start))));
  });
  return Object.freeze(rates);
}
export const TIME_RATES = createRates();
/** Nearest discrete slider position; ties use the first index. */
export function rateToSliderIndex(rate: number): number {
  finite(rate);
  let best = 0;
  for (let i = 1; i < TIME_RATES.length; i++)
    if (Math.abs(TIME_RATES[i] - rate) < Math.abs(TIME_RATES[best] - rate))
      best = i;
  return best;
}
/** Next distinct table rate in the requested direction, clamped at endpoints. */
export function adjacentRate(rate: number, direction: -1 | 1): number {
  finite(rate);
  if (direction !== -1 && direction !== 1)
    throw Error("invalid rate direction");
  if (direction === 1)
    return TIME_RATES.find((value) => value > rate) ?? TIME_RATES[100];
  return TIME_RATES.findLast((value) => value < rate) ?? TIME_RATES[0];
}
export function formatRate(rate: number): string {
  finite(rate);
  if (rate === 0) return "paused";
  if (rate === 1) return "real rate";
  const [name, seconds] = unit(rate);
  return `${roundSigned(rate / seconds)} ${name}/s`;
}
export function isLive(
  epochUTCseconds: number,
  nowMs: number,
  playing: boolean,
  rate: number,
): boolean {
  return (
    playing === true &&
    rate === 1 &&
    Number.isFinite(epochUTCseconds) &&
    Number.isFinite(nowMs) &&
    Math.abs(epochUTCseconds * 1000 - nowMs) < 1000
  );
}
