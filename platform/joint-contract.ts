export interface JointAim {
  readonly joint: string;
  readonly hingeAxis: readonly number[];
  readonly normalAxis: readonly number[];
  readonly targetDirectionIcrf: readonly number[];
}
export interface JointStatus { readonly phase: string; readonly applied: readonly string[]; readonly missing: readonly string[]; readonly ambiguous: readonly string[]; }
export function snapshotJoints(aims: readonly JointAim[]): readonly JointAim[] {
  if (!Array.isArray(aims) || aims.length > 32) throw Error("invalid model joints");
  const names = new Set<string>();
  return Object.freeze(aims.map(a => {
    if (!a || Object.keys(a).some(k => !["joint","hingeAxis","normalAxis","targetDirectionIcrf"].includes(k)) || typeof a.joint !== "string" || !a.joint.length || new TextEncoder().encode(a.joint).length > 128 || /[\u0000-\u001f\u007f-\u009f]/u.test(a.joint) || names.has(a.joint.replace(/\s/g,"_").replace(/[\[\].:/]/g,""))) throw Error("invalid model joint");
    const canonical = a.joint.replace(/\s/g,"_").replace(/[\[\].:/]/g,"");
    if (!canonical.length) throw Error("invalid canonical joint name");
    names.add(canonical);
    const vectors = [a.hingeAxis,a.normalAxis,a.targetDirectionIcrf].map(v => {
      if (!Array.isArray(v) || v.length !== 3 || v.some(n => !Number.isFinite(n)) || Math.abs(v.reduce((s,n) => s+n*n,0)-1)>1e-4) throw Error("invalid joint vector");
      return Object.freeze([...v]);
    });
    if (Math.abs(vectors[0].reduce((s,n,i) => s+n*vectors[1][i],0))>1e-4) throw Error("invalid joint axes");
    return Object.freeze({joint:a.joint,hingeAxis:vectors[0],normalAxis:vectors[1],targetDirectionIcrf:vectors[2]});
  }));
}
