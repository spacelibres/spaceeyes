# 控制器选择与Coverage名称阶段

实现基线4e5440c15；SDK0.0.45、网页0.0.71、核心0.0.54。上一批CI41264667656已由gh确认completed/success。

## 实现边界

位置轨道先筛声明覆盖，再按后声明优先检查真实DYN覆盖；不按URL中的父体名字猜测优先级。仅已证实的覆盖外/索引gap允许尝试更早轨道；网络、未知异常包、冲突窗口仍报错。ORI保持原路径，本批不宣称其多轨策略全部对齐。

服务端的x-dyn-controller-selection描述实际track及高优先源留下的有效域。payload本身与科学采样覆盖不变。lowerExclusive对应含结束点的高优先源之后；内部半开索引gap使用lowerInclusive；upperExclusive保证新高优先源开始时立即失效。客户端严格解析并同步到缓存、checkpoint/restore、retain/dispose、主/次目标刷新和私有历史，不让宽覆盖旧包跨控制器继续发布。

私有历史按当前父体及阶段选择正确源；精确闭区间末点不能误用下一段。只在需要时为单点阶段组合准备额外源，仍计入32段/200000记录预算。真实断点不连接、未知数据不伪造、辅助历史不修改主时间。

CoverageLifecycle只接受标签setter，输入和输出冻结，退出先于进入/更新，区间含端点，更新由墙钟节流且退出不重置节流；具备reset/dispose。生产名称采用纯函数阶段求值，直接跳时与倒播不遗留旧名称。清单六槽经源码hash核对，覆盖THEMIS B/C和OSIRIS-REx/APEX。标题、目录、搜索和画布共用规则，原品牌标志与视觉样式保留。

该机制不是任意JavaScript回调执行器。四个source-no-op标签replace仍不补造功能；模型切换、部件显隐、旋转参考、喷流和关节等其余槽位未全部接入。

## 先失败后修复的证据

新增测试依次复现：重叠时选中first而不是second；宽覆盖同父体缓存只请求一次而未更新；名称一直ARTEMIS P1；根覆盖优先级变化未给缓存期限；历史精确末点误用下一阶段；内部gap起点遗漏。修复后针对覆盖首尾、正倒顺序、跳时、请求数、回滚、严格失败、预算、精准历史点和名称稳定写入集中回归。

真实验证最初Juno及OSIRIS失败见real-controller-before.json。四份Juno原包均有三个字节完全相同的终止记录，独立审查证据见juno-reviewed-sources.json；仅在精确SHA命中时选择原样连续窗口，原始fixture保留。未知hash仍严格拒绝，未排序或修改样本。已知审查窗口覆盖外单独携带范围，冲突和解码错误不改成覆盖外。

real-controller-after.json重新请求NASA：Juno676350000选择ganymede/orb、THEMIS B选择earth、OSIRIS748838793选择earth/sample_return/orb，均成功。数据及耗时为本轮快照，不能作为全目录长期可用率或性能保证。

完整检查和实际GPU/界面结果以本目录最终checks.log与截图、DOM记录为准，不将源码比较或单个公式验证写成全部NASA体验认证。

最终checks.log进程exit0：194平台验证、16基础WASM、2真实DYN、73网页、61宿主、128原生渲染，加Rust/TS/clippy/ReleaseWASM/Next/资源。真实端点修复后重新执行全部检查；独立复审确认白名单匹配证据、未知hash/冲突仍严格拒绝，并修复其发现的内部gap包含性问题。

生产服务3006重启后，final-api.json记录Juno/THEMIS/OSIRIS三个HTTP接口均200，实际controller元数据贯穿HTTP。浏览器phase-dom.json验证TDB264427264显示THEMIS B、264427266显示ARTEMIS P1、反向跳回再次THEMIS B；从264427266以−1倍连续倒播至264427208.813，名称已恢复THEMIS B，模型正常。对应themis-before.png、artemis-after.png、themis-reverse.png。browser-logs.json无warn/error；结束已暂停，历史场景中11个次要目标无覆盖仍如实显示。该操作证明本批阶段切换，不证明全部镜头、轨迹和光照均已NASA一致。
