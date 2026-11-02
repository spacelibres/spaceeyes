# ORI控制器选择与缓存（SDK0.0.48 / 网页0.0.76）

依据用户批准的全局审查A04和docs/ORI控制器选择与缓存修正设计.md。核心0.0.56不变，本批不改光照、相机、动画、位置控制器优先级或画质。

NASA依据：engine/core/Entity-62.js约238–248行，按声明依次应用有效姿态控制器。服务器选最后实际覆盖ORI并给出track/有效域；仅根覆盖外回退，HTTP/坏包保留错误。多源全无覆盖以明确开区间返回，不能用一个源的覆盖代表全部源。客户端用活动声明key、实际样本覆盖及有效域共同验证缓存；只在选中ORI声明处应用，后续fixed/align/spin保留，正倒跳、回滚和释放一起处理。

TDD证据：旧实现选源顺序、缓存切换、absence、槽位重复应用及无效元数据测试先失败。独立审查额外发现absence预算绕过，257对象回归先失败再修复；combined对象预算包含位置/姿态/ORI元数据，清理回滚有测试。不以数量上限增加换通过。

真实验证：real-ori-boundaries.json记录Mars2020/MSL/InSight边界前/精确/后9次ORI查询。MSL在闭端点由飞行quat切地表quat_v2，较早缓存upperExclusive正确；InSight着陆后服务器无ORI覆盖，客户端按后续固定LLA得到derived姿态。real-boundaries.json记录实际数据插件：MSL/InSight三时刻位置和姿态ready；Mars2020被独立位置源错误阻断，不能称完整场景通过。mars-position-baseline.json确认0.0.75旧生产服务器同样报错；本批没有夹带修复。Mars2020的独立ORI查询均得到有效surface/quat_v2，不能以此替代位置与完整模型验收。

position-regression.json确认三个已修复飞船经新服务器位置仍ready。完整检查及页面结果另存本目录；GPU完成时间、全量NASA成对姿态数值/画面验收未完成，不能把单元测试和选源正确说成全部天体姿态已对齐。Lucy坏索引/Juno坏包/ISS403继续严格报告，不回退掩盖错误。

## 最终检查与页面

预算修正后的完整check-core.ps1退出0：217平台/验证、17基础WASM、2真实DYN、98网页、65宿主、144原生渲染，含fmt/clippy/TS/ReleaseWASM/Next/资源；checks.log为最终重跑，不沿用修正前结果。独立复核见review.md，无剩余具体阻塞。

生产页面MSL显示ready/显示资源ready、NASA Eyes DYN姿态可用；InSight显示ready/显示资源ready、实体控制器推导姿态。截图msl-ready.png、insight-status.png。insight-ready.png记录近距构图仍有待校准，不将其作为视觉全通过截图；视口在人工操作中发生变化，不作固定性能比较。浏览器日志见browser-logs.json。本批GPU只验证实际资源/姿态链能运行，不证明NASA同视角视觉等价或GPU完成耗时。
