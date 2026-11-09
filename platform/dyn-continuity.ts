import type { DecodedDyn } from './dyn-decoder.ts';
export type ScientificInterval = readonly [number, number];
/** Exact record equality is deliberately stronger than approximate orbit agreement. */
export function sameDynLayout(a: DecodedDyn, b: DecodedDyn): boolean {
  return a.kind === 'inline' && b.kind === 'inline' && a.type === b.type &&
    a.version === b.version && a.sourceType === b.sourceType &&
    a.gravitationalParameter1 === b.gravitationalParameter1 && a.gravitationalParameter2 === b.gravitationalParameter2;
}
/** Both knot sets must agree throughout advertised overlap, including missing knots. */
export function identicalDynOverlap(a: DecodedDyn, b: DecodedDyn): boolean {
  if (!sameDynLayout(a,b) || a.kind !== 'inline' || b.kind !== 'inline' ||
      a.coverage.start > b.coverage.end || b.coverage.start > a.coverage.end) return false;
  const left = new Map(a.records.map(record => [record.time, JSON.stringify(record)]));
  const right = new Map(b.records.map(record => [record.time, JSON.stringify(record)]));
  for (const record of a.records) if (record.time >= b.coverage.start && record.time <= b.coverage.end && left.get(record.time) !== right.get(record.time)) return false;
  for (const record of b.records) if (record.time >= a.coverage.start && record.time <= a.coverage.end && right.get(record.time) !== left.get(record.time)) return false;
  return true;
}
/** Only identical adjacent bracketing records prove identical interpolation.
 * Matching advertised knots alone cannot certify a trimmed/extrapolated edge. */
export function unchangedDynIntervals(a: DecodedDyn, b: DecodedDyn): ScientificInterval[] {
  if (!identicalDynOverlap(a,b) || a.kind !== 'inline' || b.kind !== 'inline') return [];
  const next = new Map(b.records.map((record,index) => [record.time,index]));
  const ranges: [number,number][] = [];
  for (let i=0;i<a.records.length-1;i++) {
    const left=a.records[i], right=a.records[i+1], j=next.get(left.time);
    if (j === undefined || j+1 >= b.records.length || JSON.stringify(left)!==JSON.stringify(b.records[j]) || JSON.stringify(right)!==JSON.stringify(b.records[j+1])) continue;
    const start=Math.max(left.time,a.coverage.start,b.coverage.start), end=Math.min(right.time,a.coverage.end,b.coverage.end);
    if (start>=end) continue;
    const last=ranges.at(-1);
    if(last && last[1]===start) last[1]=end; else ranges.push([start,end]);
  }
  return ranges;
}
