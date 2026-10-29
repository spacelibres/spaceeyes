export type VisualSpec =
  { kind: 'model'; assetId: string; scene: number; scaleKmPerUnit: number } |
  { kind: 'sphere'; textureAsset?: string | null };
export interface VisualStatus {
  revision: string;
  phase: 'pending' | 'loading' | 'ready' | 'failed' | 'suspended';
  detail: string | null;
}

function assetId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/.test(value)) throw new Error('invalid asset id');
  return value;
}

export function snapshotVisual(spec: VisualSpec): Readonly<VisualSpec> {
  if (!spec || typeof spec !== 'object') throw new Error('invalid visual spec');
  const allowed = spec.kind === 'model' ? ['kind', 'assetId', 'scene', 'scaleKmPerUnit'] : ['kind', 'textureAsset'];
  if (Object.keys(spec).some(key => !allowed.includes(key))) throw new Error('invalid visual fields');
  if (spec.kind === 'model') {
    if (!Number.isSafeInteger(spec.scene) || spec.scene < 0 || spec.scene > 1023 ||
      !Number.isFinite(spec.scaleKmPerUnit) || spec.scaleKmPerUnit <= 0) throw new Error('invalid model visual');
    return Object.freeze({ kind: 'model', assetId: assetId(spec.assetId), scene: spec.scene, scaleKmPerUnit: spec.scaleKmPerUnit });
  }
  if (spec.kind === 'sphere') return Object.freeze({ kind: 'sphere', textureAsset: spec.textureAsset == null ? null : assetId(spec.textureAsset) });
  throw new Error('invalid visual kind');
}
