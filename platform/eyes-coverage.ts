/** Controlled translation only: never executes recovered NASA callback source. */
export type CoverageAction = Readonly<{kind:'label-text'; text:string}>;
export interface CoverageDefinition {
 readonly coverage: readonly [number,number];
 readonly enter?: readonly CoverageAction[];
 readonly exit?: readonly CoverageAction[];
 readonly update?: readonly CoverageAction[];
 readonly updateIntervalMs?: number;
}
export class CoverageLifecycle {
 private definitions: readonly CoverageDefinition[];
 private active: boolean[]=[];
 private last: number[]=[];
 private disposed=false;
 constructor(definitions: readonly CoverageDefinition[]) {
  this.definitions=definitions.map(d=>{
   if(Number.isNaN(d.coverage[0])||Number.isNaN(d.coverage[1])||d.coverage[0]>d.coverage[1]||!Number.isFinite(d.updateIntervalMs??0)||(d.updateIntervalMs??0)<0) throw new RangeError('Invalid coverage');
   return {...d,coverage:[...d.coverage] as [number,number],enter:d.enter?.map(a=>Object.freeze({...a})),exit:d.exit?.map(a=>Object.freeze({...a})),update:d.update?.map(a=>Object.freeze({...a}))};
  });
  this.reset();
 }
 reset():void {if(this.disposed) throw new Error('Disposed coverage lifecycle');this.active=this.definitions.map(()=>false);this.last=this.definitions.map(()=>-Infinity);}
 dispose():void {this.active=[];this.last=[];this.definitions=[];this.disposed=true;}
 update(epoch:number,wallClockMs:number):readonly CoverageAction[] {
  if(this.disposed) throw new Error('Disposed coverage lifecycle');
  if(!Number.isFinite(epoch)||!Number.isFinite(wallClockMs)) throw new RangeError('Finite clocks required');
  const next=this.definitions.map(d=>d.coverage[0]<=epoch&&epoch<=d.coverage[1]);
  const actions:CoverageAction[]=[];
  this.definitions.forEach((d,i)=>{if(this.active[i]&&!next[i]) actions.push(...d.exit??[]);});
  this.definitions.forEach((d,i)=>{
   if(next[i]&&!this.active[i]) actions.push(...d.enter??[]);
   if(next[i]&&d.update&&wallClockMs-this.last[i]>=(d.updateIntervalMs??0)){actions.push(...d.update);this.last[i]=wallClockMs;}
  });
  this.active=next;return Object.freeze(actions);
 }
}

// Fixed six slots from docs/evidence/time-history-0.0.69/coverage-actions.json.
export const EYES_COVERAGE_LABEL_MANIFEST = [
  {
    "entity": "sc_themis_b",
    "controllerIndex": 4,
    "coverage": [
      "-Infinity",
      264427265
    ],
    "phase": "enter",
    "sourceSha256": "86a61d33e4c2ed6c46b1716d606a01dec3a88b463b24bf638260a8134b528ccf",
    "from": "ARTEMIS P1",
    "text": "THEMIS B"
  },
  {
    "entity": "sc_themis_b",
    "controllerIndex": 4,
    "coverage": [
      "-Infinity",
      264427265
    ],
    "phase": "exit",
    "sourceSha256": "d697ff8e724c41ab7e3adee986d9585760f9ed98365768f27bc6dd45ac29f38f",
    "from": "THEMIS B",
    "text": "ARTEMIS P1"
  },
  {
    "entity": "sc_themis_c",
    "controllerIndex": 4,
    "coverage": [
      "-Infinity",
      264427265
    ],
    "phase": "enter",
    "sourceSha256": "dc5992cb52474bd7eac0aea4e65089c700fd957e1ae6c3c891fd5c02adf1d0a8",
    "from": "ARTEMIS P2",
    "text": "THEMIS C"
  },
  {
    "entity": "sc_themis_c",
    "controllerIndex": 4,
    "coverage": [
      "-Infinity",
      264427265
    ],
    "phase": "exit",
    "sourceSha256": "db261f3c0460ce3b52c6c4ff89265cc1765182b54687631c70bb2aeb1396bdef",
    "from": "THEMIS C",
    "text": "ARTEMIS P2"
  },
  {
    "entity": "sc_osiris_rex",
    "controllerIndex": 11,
    "coverage": [
      748838793,
      "Infinity"
    ],
    "phase": "enter",
    "sourceSha256": "ce7e38c35275e92229757cf39df493b2c7a93a5f962a52d7f55dddd463c04291",
    "from": "REx",
    "text": "APEX"
  },
  {
    "entity": "sc_osiris_rex",
    "controllerIndex": 11,
    "coverage": [
      748838793,
      "Infinity"
    ],
    "phase": "exit",
    "sourceSha256": "5b868b1ee8881f9b75111dcb4c6b39a672cba061e351aae15b046552e0564a23",
    "from": "APEX",
    "text": "REx"
  }
] as const;
/** Resolves the currently authored phase from a base name, with no lifecycle residue. */
export function eyesCoverageLabel(id:string,epoch:number,baseName:string):string {
 if(!Number.isFinite(epoch)) return baseName;
 const slots=EYES_COVERAGE_LABEL_MANIFEST.filter(s=>s.entity===id);
 const enter=slots.find(s=>s.phase==='enter');
 if(!enter) return baseName;
 const start=Number(enter.coverage[0]),end=Number(enter.coverage[1]);
 const phase=start<=epoch&&epoch<=end?'enter':'exit';
 const slot=slots.find(s=>s.phase===phase);
 return slot?baseName.replace(slot.from,slot.text):baseName;
}

