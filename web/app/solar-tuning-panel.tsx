"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {solarWorkspaceSettings} from "../lib/solar-settings";
import allControls from "../../platform/stellar-controls.json";
import { stellarDefaults, describeStellarWind, applySolarReferencePalette, applySolarObservationPreset } from "../../platform/stellar-tuning";

const activeKeys=new Set(["surfaceEnabled","archesEnabled","surfaceGain","surfaceColor","flowSpeed","paused","archGain","archCount","strandCount","archHeight","archSpread","archWidth","archEdge","archCoolColor","archHotColor","enterDistance","exitDistance","fullDistance"]);
const controls=allControls.filter((c,i)=>activeKeys.has(c.key)||(i>=58&&c.key!=="observationStyle"));
const storageKey = "spaceeyes.solar-tuning.v1";
const switches = new Set(["surfaceEnabled", "volumeEnabled", "archesEnabled", "paused", "observationStyle"]);
const geometry = new Set(["archCount", "strandCount", "archHeight", "archSpread", "archWidth", "prominenceHeightKm", "prominenceWidthKm", "prominenceLengthKm"]);
const groups = [...new Set(controls.filter(c=>c.key!=="observationStyle").map(c => c.group))];
type Settings = Record<string, number>;

export function SolarTuningPanel({ active, onApply, initial }: { active: boolean; onApply: (settings: Settings) => void; initial?: Settings }) {
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(initial ?? stellarDefaults()).map(([k,v]) => [k,String(v)])));
  const valid = useRef<Settings>({ ...(initial ?? stellarDefaults()) });
  const [error, setError] = useState("");
  const [json, setJson] = useState("");
  const [notice, setNotice] = useState("");
  const frame = useRef<number | null>(null);
  const apply = useRef(onApply);
  apply.current = onApply;
  const activeRef = useRef(active);
  activeRef.current = active;
  const schedule = () => {
    if (!activeRef.current || frame.current !== null) return;
    frame.current = requestAnimationFrame(() => { frame.current = null; if (activeRef.current) apply.current({ ...valid.current }); });
  };
  const accept = (input: unknown) => {
    try {
      const next = { ...solarWorkspaceSettings(input) };
      valid.current = next;
      setDraft(Object.fromEntries(Object.entries(next).map(([k,v]) => [k,String(v)])));
      setError(""); schedule();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => {
    // Opening the panel must never publish or change the solar appearance.
    return () => { if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  const commit = (next: Record<string,string>) => {
    if (Object.values(next).some(v => !v.trim())) { setError("数值不能为空；仍保留最后有效配置。"); return; }
    accept(Object.fromEntries(Object.entries(next).map(([k,v]) => [k,Number(v)])));
  };
  const edit = (key: string, value: string, deferred = false) => {
    const next = { ...draft, [key]: value }; setDraft(next);
    if (!deferred) commit(next);
  };
  const wind = useMemo(()=>describeStellarWind(valid.current),[valid.current.temperatureMK,valid.current.densityCm3]);
  return <details className="solar-tuning"><summary>太阳特效调试 <small>{controls.length} 项参数</small></summary>
    <p>程序化表面与运动学日珥，非完整 MHD/NLTE · 参数不改变科学半径</p>
    <p>文献约束：日珥核心温度约 7500–9000 K，电子密度 10⁹–10¹¹ cm⁻³，宁静日珥磁场常见 8–10 G；当前仅约束运动学重建，不求解磁场平衡。</p><p>太阳统一显示，远近只改变细节。日珥基准尺寸（km）仍乘高度、跨度与宽度倍率。</p><fieldset disabled={!active}><legend>{active ? "实时预览" : "进入工作区后可调整"}</legend>
      {groups.map(group => <details key={group} className="solar-tuning-group"><summary>{group} <small>{controls.filter(c => c.group === group && c.key!=="observationStyle").length} 项</small></summary>
        <button type="button" onClick={() => { const next = { ...valid.current }; controls.filter(c => c.group === group && c.key!=="observationStyle").forEach(c => { next[c.key] = c.value; }); accept(next); }}>恢复本组默认</button>
        {controls.filter(c => c.group === group && c.key!=="observationStyle").map(c => <div className="solar-tuning-control" key={c.key}>
          <label htmlFor={`solar-${c.key}`}>{c.label} {c.unit !== "color" && c.unit}</label>
          {switches.has(c.key) ? <input id={`solar-${c.key}`} type="checkbox" checked={draft[c.key] === "1"} onChange={e => edit(c.key,e.target.checked ? "1" : "0")} /> : c.unit === "color" ? <input id={`solar-${c.key}`} type="color" value={`#${Number(draft[c.key]).toString(16).padStart(6,"0")}`} onChange={e => edit(c.key,String(parseInt(e.target.value.slice(1),16)))} /> : <>
            <input id={`solar-${c.key}`} type="range" min={c.min} max={c.max} step={c.step} value={draft[c.key] || c.min} onChange={e => edit(c.key,e.target.value,geometry.has(c.key))} onPointerUp={() => geometry.has(c.key) && commit(draft)} onKeyUp={() => geometry.has(c.key) && commit(draft)} onBlur={() => geometry.has(c.key) && commit(draft)} />
            <input aria-label={`${c.label}数值`} type="number" min={c.min} max={c.max} step={c.step} value={draft[c.key] ?? ""} onChange={e => edit(c.key,e.target.value,true)} onBlur={() => commit(draft)} onKeyDown={e => { if(e.key === "Enter") commit(draft); }} />
          </>}
          <small>范围 {c.min}–{c.max} · 默认 {c.unit === "color" ? `#${c.value.toString(16).padStart(6,"0")}` : c.value}</small>
        </div>)}
      </details>)}
      <p className="solar-tuning-note">日冕只在近景绘制；日珥最多50000顶点。几何参数松开后更新。</p>
      <div className="solar-tuning-actions"><button type="button" onClick={() => accept(applySolarObservationPreset(valid.current))}>恢复太阳推荐参数</button><button type="button" onClick={() => accept(applySolarReferencePalette(valid.current))}>应用参考图配色</button><button type="button" onClick={() => accept({ ...valid.current, surfaceEnabled:0,volumeEnabled:0,archesEnabled:0,coronaGain:0 })}>关闭特效</button><button type="button" onClick={() => { try { localStorage.setItem(storageKey,JSON.stringify({ version:2,settings:valid.current })); setNotice("已保存到本机"); } catch(e) { setError(`保存失败：${String(e)}`); } }}>本机保存</button></div>
      <details><summary>配置 JSON</summary><textarea aria-label="太阳特效配置 JSON" value={json} onChange={e => setJson(e.target.value)} /><div className="solar-tuning-actions"><button type="button" onClick={() => setJson(JSON.stringify({version:2,settings:valid.current},null,2))}>导出 JSON</button><button type="button" onClick={() => { try { const parsed = JSON.parse(json); if(![1,2].includes(parsed.version)) throw new Error("仅支持 version: 1 或 2"); accept(parsed.settings); } catch(e) { setError(`导入失败：${String(e)}`); } }}>导入 JSON</button></div></details>
    </fieldset>
    {error && <p role="alert" className="solar-tuning-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <details><summary>Parker 模型诊断与来源</summary><p>音速 {(wind.soundSpeedMS/1000).toFixed(1)} km/s · 临界半径 {wind.sonicRadiusR.toFixed(2)} R · 1 AU 风速 {(wind.oneAuSpeedMS/1000).toFixed(1)} km/s · 电子密度 {wind.oneAuDensityCm3.toFixed(2)} cm⁻³</p><p>等温 Parker 显示模型，查表范围 1–12 R；NASA 对象科学半径与模型名义太阳半径分别保留。</p><p>只读模型常数：GM☉ = 1.3271244×10²⁰ m³/s²；R☉ = 695700000 m；kB = 1.380649×10⁻²³ J/K；mp = 1.67262192595×10⁻²⁷ kg。来源：<a href="https://www.iau.org/">IAU 名义太阳参数</a>、<a href="https://physics.nist.gov/cuu/Constants/">NIST CODATA（kB、质子质量）</a>；AU = 149597870700 m。</p></details>
  </details>;
}

export default SolarTuningPanel;
