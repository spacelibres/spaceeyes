import DynInspector from "../dyn-inspector";
export default function Diagnostics() {
  return (
    <main>
      <a href="/">← 返回太阳系工作区</a>
      <h1>DYN 数据诊断</h1>
      <p>用于检查数据格式与来源；此页不代表三维场景验收。</p>
      <DynInspector />
    </main>
  );
}
