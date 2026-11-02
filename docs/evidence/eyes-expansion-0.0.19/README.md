# NASA Eyes 全量卫星与航天器接入验收

日期：2026-10-30。分支：codex/bevy-planning。SDK 0.0.17、网页 0.0.19；Rust/Bevy/WASM 仍为 0.0.15。本批按已确认接入设计完成可用目录、数据与资源链路。

## 全量结果

| 层次 | 核查结果 | 证据 |
|---|---|---|
| 目标目录 | 451 天然卫星 + 171 航天器 = 622；合并十对象基线并去重 Moon 后用户目录 631 | platform/eyes-catalog.json、生成器及目录测试 |
| 源定义 | 619 有定义，3 缺失：sc_isas、sc_lunar_trailblazer、sc_lunir | data-audit.json |
| 科学状态 | 固定测试时刻 846620500 TDB 秒：545 ready、74 非当前任务覆盖；全部 74 在另一个实际有效任务时间取得有限位置 | data-audit.json；有效时间提示仅用于重新请求求值 |
| 模型 | 131/131 独立 glTF 入口实际转换成功 | model-conversion.json，逐模型 GLB 字节与哈希 |
| 表面 | 18 个对象的 108/108 六面表面图实际转换成功 | surface-conversion.json |
| 源依赖 | 固定 1238 项原始 URL、长度与 SHA256，原始总量 622416121 字节 | validation/eyes-dependencies.json |
| 自动检查 | 157 项不同测试通过，另含 TS、Rust lint/format、发布 WASM、资源和 Next 生产构建 | checks.log |

157 = Rust 41（基础 27 + 原生渲染 24，扣除重复基础 10）+ 平台/验证 68 + WASM 5 + 样本 2 + 网页 29 + 真实 WASM 宿主集成 12。没有将重复运行算成新测试。

三项缺失不计成功，不用猜测 URL 或球体代替飞船。74 项有效时间包括历史及未来任务；当前不可用不等同服务器故障。619 项有限状态可求值不等同外部科学精度认证。

## 实际 GPU 与交互

在 Windows 的真实浏览器运行 Next 生产服务 http://127.0.0.1:3006/，保留原 spacelibre SVG 标识。实际选择、确认数据与视觉 ready，再检查以下画面：

- ISS、Juno：真实航天器模型，独立材质和太阳翼。
- Phobos、Deimos：实际非球面模型、表面纹理及火星父体。
- Io、Europa、Ganymede、Callisto：木星父体、四大卫星系统数据、各自六面表面图。
- Cassini：当前覆盖外明确报告，跳到有效 1997-10-15 任务时间后模型与科学状态恢复，旧错误清除。
- Voyager 1：位置型 DYN、开放覆盖路径，未强行生成闭合椭圆。
- SPHEREx：源 WebP 主纹理，未请求无效的导出备用 JPEG。
- Danuri：实际 Draco 几何与 Basis/KTX2 纹理经服务器解码后由 Bevy 显示。

对应 PNG 保存在本目录；GPU 是代表样本检查，不宣称 622 个对象逐一像素验收。模型部分观察角度背光，未用无光材质掩盖日照差异。

实际操作确认 3600 倍正向、暂停、-3600 倍反向时间变化，再返回太阳系总览并切回当前时间，恢复十对象基线。最终浏览器 error 日志为空，见 browser-errors.json；总览见 overview-final-gpu.png。

## 架构与运行边界

目录登记只提供元数据。初始仅十对象基线；选择时加载目标、当时父体链及至多 24 个主要卫星。轨迹继续遵守每会话 4096 点；非 orb 源使用有效覆盖内的开放路径。任务切换按实际父体时间表、TDB 与原数据控制器求值，不运行恢复源码中的任意函数。

模型局部变换和源单位在服务器统一为 km，SDK 使用 scaleKmPerUnit=1。源模型 extents 作为取景范围单列；426 个小卫星使用源自身三个通用示意模型，不代表实测形状。任务部件动画、所有姿态精度、环阴影、材质视觉和全量性能仍需后续分项验收。

DYN 读取最多四并发；资源转换最多二并发，单源文件 64 MiB、派生 GLB 256 MiB、磁盘缓存 3 GiB。共享资源取消只撤销该订阅，源/派生缓存与转换修订绑定，迟到结果不复活旧对象。服务器缓存不进入 Git，也不进入 WASM；发布 WASM 原始大小仍为 29099442 字节。

## 复核

从仓库根目录运行：

```powershell
pwsh -NoProfile -File tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets
node tools/audit-eyes-data.mjs
```

模型转换全量复核在 web 目录运行 `node ../tools/prepare-eyes-models.ts`，复用受预算约束的服务器缓存，不代表网页启动全量下载。静态目录再生成须向 tools/import-eyes-catalog.mjs 提供明确的参考源码目录；平台构建不依赖该外部目录。所有真实源审计是指定日期快照，未来源哈希改变须重新审查。

## 来源与许可

数据和资源来自 NASA Eyes Solar System 及用户指定的 spacelibres/solarsystem 参考资料；转换使用 npm 锁定的 glTF Transform、Draco、Basis Universal（loaders.gl 提供）、Sharp 与 gl-matrix。项目代码保持 MIT；第三方库遵循各包许可证，NASA 图片/模型来源不因平台 MIT 自动转为本项目版权，也不表示 NASA 为本项目背书。

本批已经目录、数据、资源与宿主专项审查及最终跨模块审查。远端 Actions 在推送后以对应完整提交 SHA 通过 gh 查询，不能用本地通过代替远端结论。
