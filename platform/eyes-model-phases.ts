import config from './eyes-model-phases.json' with { type: 'json' };
import { getEyesDefinition } from './eyes-catalog.ts';

export type ModelPhase = {
  readonly key: `phase-${number}`;
  readonly model: {
    readonly url: string;
    readonly scale?: number | readonly number[];
    readonly rotate?: readonly Readonly<Record<string, number>>[];
    readonly translate?: readonly number[];
    readonly rotationWxyz?: readonly [number, number, number, number];
  };
  readonly hiddenNodes: readonly string[];
};
type Action = (typeof config.actions)[number];
type Compiled = {
  actions: readonly Action[];
  variants: readonly ModelPhase[];
  byMask: ReadonlyMap<number, ModelPhase>;
};
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
freeze(config);
const compiled = new Map<string, Compiled>();
const empty: readonly ModelPhase[] = Object.freeze([]);

function coverageMask(actions: readonly Action[], epoch: number): number {
  let mask = 0;
  for (let i = 0; i < actions.length; i++) {
    const [start, end] = actions[i]!.coverage;
    if (epoch >= Number(start) && epoch <= Number(end)) mask |= 1 << i;
  }
  return mask;
}

// Compile only reviewed literal actions. NASA callbacks are never executed.
for (const id of new Set(config.actions.map(action => action.entity))) {
  const actions = config.actions.filter(action => action.entity === id)
    .sort((a, b) => a.controllerIndex - b.controllerIndex);
  const boundaries = [...new Set(actions.flatMap(action => action.coverage.map(Number))
    .filter(Number.isFinite))].sort((a, b) => a - b);
  const samples = boundaries.flatMap((boundary, index) => [
    boundary - .00001, boundary, boundary + .00001,
    ...(index ? [boundaries[index - 1]! + (boundary - boundaries[index - 1]!) / 2] : []),
  ]).sort((a, b) => a - b);
  const variants: ModelPhase[] = [];
  const byMask = new Map<number, ModelPhase>();
  const byState = new Map<string, ModelPhase>();
  for (const epoch of samples) {
    const mask = coverageMask(actions, epoch);
    if (byMask.has(mask)) continue;
    const model = structuredClone(getEyesDefinition(id)!.model!) as {
      url: string; scale?: number | number[]; rotate?: Record<string, number>[];
      translate?: number[]; rotationWxyz?: [number, number, number, number];
    };
    const hidden = new Set<string>();
    for (const phase of ['exit', 'enter']) {
      for (let i = 0; i < actions.length; i++) {
        const action = actions[i]!;
        const active = (mask & (1 << i)) !== 0;
        if (action.phase !== phase || active !== (phase === 'enter')) continue;
        Object.assign(model, action.model);
        for (const [name, on] of action.hidden) {
          if (on) hidden.add(String(name));
          else hidden.delete(String(name));
        }
      }
    }
    const state = { model, hiddenNodes: [...hidden].sort() };
    const signature = JSON.stringify(state);
    let result = byState.get(signature);
    if (!result) {
      result = freeze({ key: `phase-${variants.length}`, ...state });
      variants.push(result);
      byState.set(signature, result);
    }
    byMask.set(mask, result);
  }
  compiled.set(id, { actions: Object.freeze(actions), variants: Object.freeze(variants), byMask });
}

export function eyesModelVariants(id: string): readonly ModelPhase[] {
  return compiled.get(id)?.variants ?? empty;
}
export function eyesModelPhase(id: string, epoch: number): ModelPhase | undefined {
  if (!Number.isFinite(epoch)) return undefined;
  const entity = compiled.get(id);
  return entity?.byMask.get(coverageMask(entity.actions, epoch));
}
