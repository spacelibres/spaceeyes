"use client";
import { useEffect, useRef, useState } from "react";
import { ResourceClient } from "../../platform/resource-client.ts";
import { decodeDyn } from "../../platform/dyn-decoder.ts";
import { dynCatalog, type DynId } from "../lib/dyn-catalog";
export default function DynInspector() {
  const session = useRef<{
    controller: AbortController;
    client: ResourceClient;
  } | null>(null);
  const [result, setResult] = useState("尚未请求真实DYN"),
    [busy, setBusy] = useState(false);
  function cancel() {
    session.current?.controller.abort();
    session.current?.client.clear();
    session.current = null;
  }
  useEffect(() => {
    const hide = () => cancel();
    window.addEventListener("pagehide", hide);
    return () => {
      window.removeEventListener("pagehide", hide);
      cancel();
    };
  }, []);
  async function inspect(id: DynId) {
    cancel();
    const current = {
      controller: new AbortController(),
      client: new ResourceClient(
        Object.entries(dynCatalog).map(([id, entry]) => ({
          id,
          path: `/api/dyn/${id}`,
          maxBytes: entry.bytes,
        })),
      ),
    };
    session.current = current;
    setBusy(true);
    setResult("按需获取固定NASA端点并验证散列…");
    try {
      const bytes = await current.client.read(id, current.controller.signal);
      const decoded = decodeDyn(bytes);
      if (session.current !== current) return;
      setResult(
        `类型 ${decoded.type} / ${decoded.kind} · 版本 ${decoded.version} · 数量 ${decoded.kind === "index" ? decoded.segments.length : decoded.records.length}\n原始ET覆盖 ${decoded.coverage.start} 至 ${decoded.coverage.end}\n来源 ${dynCatalog[id].source}\n仅解析，参考系与科学求值未验收。未向Rust发布，不将ET当作TDB或ICRF。`,
      );
    } catch (error) {
      if (session.current === current)
        setResult(`获取/解析失败：${String(error)}`);
    } finally {
      if (session.current === current) setBusy(false);
    }
  }
  return (
    <section className="timeline">
      <h2>真实DYN结构检查</h2>
      <p>独立按需检查，不替代上方合成场景，不表示真实轨道已接通。</p>
      {Object.keys(dynCatalog).map((id) => (
        <button
          key={id}
          disabled={busy}
          onClick={() => void inspect(id as DynId)}
        >
          检查真实DYN · {id}
        </button>
      ))}
      <button
        disabled={!busy}
        onClick={() => {
          cancel();
          setBusy(false);
          setResult("已取消真实DYN请求");
        }}
      >
        取消请求
      </button>
      <pre
        style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
        role="status"
      >
        {result}
      </pre>
    </section>
  );
}
