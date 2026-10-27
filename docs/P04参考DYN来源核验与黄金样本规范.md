# P04 参考DYN来源核验与黄金样本规范

版本：0.0.1｜状态：来源与格式证据已核验；插件实现与真实科学样本仍待授权｜日期：2026-10-27

依据：`docs/太空之眼平台架构书.md` §14/§15、`docs/NASA-Dynamo-插件设计规范.md` §4/§7、`docs/第三方来源与许可台账.md`、`docs/全设计要求实现与集中验收台账.md` P04/P12、`docs/开发进度与验收.md` M4 进入条件。本增量只准备证据与规范，不实现插件，不把合成样本当成科学验证。

## 1. 范围与结论

本文件回答三个问题：

1. 参考仓库究竟固定在哪一个提交，哪些文件属于自研 TS、恢复的 NASA 源码或 NASA 原始数据；
2. SPACEEYES 可以复用哪些成果、必须排除哪些资产；
3. 在真实 NASA 样本再分发许可未确认前，五类 DYN 黄金样本如何以可复核的合成数据定义，并明确它们不能证明什么。

结论：

- 参考仓库 `spacelibres/solarsystem` 固定提交为 `4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db`（版本 0.2.73，2026-10-25）。
- 仓库根没有 `LICENSE`/`COPYING`/`NOTICE`；`package.json` 声明 `"license": "MIT"`、`"private": true`。GitHub 因此不识别仓库级许可文件。
- `src/lib/dynamo/*`、`src/solar/domain/ephemeris.ts`、`src/solar/runtime/ephemeris-repository.ts` 及 `src/solar/runtime/explorer-runtime.ts` 的星历集成部分，是无 NASA 版权头的自研 TypeScript，可按包级 MIT 声明复用，但必须保留固定提交、文件摘要与上游署名。
- `eyes/` 是恢复的 NASA Eyes 应用源码；`tests/fixtures/*.dyn`、`eyes/src/dyn/*`、`eyes/src/models/*` 是 NASA/外部数据与模型。二者均不得复制进 SPACEEYES，也不得打包进插件制品。
- 真实 NASA 黄金样本的再分发条件仍未确认，因此真实样本只能由贡献者在本地做差分核验，不进入仓库与 CI。合成样本只验证解析与求值机制，不证明科学精度。

## 2. 固定基线

| 项目 | 值 |
|---|---|
| 仓库 | `https://github.com/spacelibres/solarsystem`（公开） |
| 默认分支 | `main` |
| 固定提交 | `4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db` |
| 提交时间 | 2026-10-25T03:13:57Z |
| 包版本 | `spacelibre-solarsystem` 0.2.73 |
| 包许可声明 | `"license": "MIT"`，`"private": true` |
| 根许可文件 | 无 `LICENSE`/`COPYING`/`NOTICE` |
| GitHub 许可识别 | 无（未检测到许可文件） |
| 已知第三方声明 | 仅 `eyes/THIRD_PARTY_LICENSES.txt`（OverlayScrollbars、Three.js、moment-timezone 等 JS 依赖） |
| 署名要求 | README 声明星历与行星图像来自 NASA/JPL，并声明与 NASA 无隶属或背书关系 |

`private: true` 只阻止误发布到 npm，不构成对源码的额外限制；但仓库缺少许可文件、且混有恢复源码与 NASA 数据，因此不能把整个仓库当作统一 MIT 资产。

## 3. 逐文件核验

摘要为对应固定提交下原始字节的 SHA-256。

### 3.1 自研 TypeScript（可按包级 MIT 复用）

| 文件 | 字节 | SHA-256 | 判定 |
|---|---:|---|---|
| `src/lib/dynamo/reader.ts` | 2471 | `e9d4ff33bfd8b6ca37a9253eb30a16efcc34ddb0e2d061a55a7d79bb814b8790` | 自研小端读取器，无 NASA 版权头；可复用并署名 |
| `src/lib/dynamo/parse.ts` | 9711 | `d0f8df3f2e455b4ae08a11eb6626e22c4a3a17bd49cd0b28cb66c851ceddc759` | 自研 DYN 解析器，格式为逆向并对照真实资产验证；可复用并署名 |
| `src/lib/dynamo/math.ts` | 1313 | `a1293ff3bab36f1342d0faa35fdfdccb5552686a8d6ac674b453eff3a188930c` | 自研向量/四元数工具；可复用并署名 |
| `src/lib/dynamo/orbit.ts` | 3460 | `56183773fbba5262bd2601955462eac01f08162700c25370c7108f4647ef7edc` | 自研二体开普勒投影；可复用并署名 |
| `src/lib/dynamo/loader.ts` | 6853 | `5582c73be0dcfa1dd8ffe6a72b415a414ad1890cb6d02c2dc73b70bb983782d0` | 自研浏览器加载器，含 NASA 地址构造；地址策略需由宿主代理重写 |
| `src/solar/domain/ephemeris.ts` | 12470 | `f8a0f3985d6747c022400080d2cdef1c72f1c53745ea837d21ac99e0e38e08ae` | 自研完整求值器；可复用并署名 |
| `src/solar/runtime/ephemeris-repository.ts` | 14369 | `2266cc58359211d308325be19bfdbd2efdc247bab4f6fa6e1d61c8be9d35bf78` | 自研仓库/缓存/错误映射；可复用并署名 |
| `src/solar/runtime/explorer-runtime.ts` | 13949 | `6a8488f9c16db8a9a4cda6a9998e5fc43d2b720f288139cdd697576719973457` | 自研运行时；只复用星历集成部分，不搬 UI/场景编排 |
| `tests/dynamo.test.ts` | 7227 | `bb7c0a7a7ac1b6b1a0a4054f46e1ce7b9740aa973c0396a59153c16f01dcfc` | 自研测试；行为可重新表达，不整文件复制 |
| `tests/solar-ephemeris.test.ts` | 13979 | `d4e584d0a9f94743e0b2629aff60071519ae87ca6de7a94102e8eef0fa527282` | 自研测试；同上 |

复用动作要求：

- 在插件包内保留来源仓库、固定提交、文件路径与上述摘要；
- 保留 MIT 声明文本及上游署名，不把 NASA/JPL 数据署名混入代码许可；
- 任何改写都要重新计算摘要并更新记录，不能继续声称“逐字节同一”；
- 既然仓库无根 `LICENSE`，若后续法务要求更强的书面证据，应向上游索取许可文件或改为独立实现；在此之前把此缺失记为风险。

### 3.2 恢复源码与 NASA 数据（禁止复制）

| 文件/目录 | 字节 | SHA-256 | 判定 |
|---|---:|---|---|
| `eyes/src/engine/controllers/DynamoController.js` | 34037 | `a026264a2e6cbec9315ea7fe4aa93ebf9c41e1752592801750ff8b900c6806e6` | 恢复的 NASA Eyes 源码；不复制、不迁移 |
| `tools/semantic-dynamo.node-check.cjs` | 10482 | `afd94c0cecb894479ef2ed361d47d5705f3fd4b04b57f04f498eb4ab56ede171` | 依赖 `eyes/` 恢复源码做 VM 对比；不作为复用入口 |
| `tests/fixtures/earth-sun-orb.dyn` | 30916 | `5c31b43bcd091f63c314da053595f67ea4277f9a71584e2a901983cf8041a580` | NASA 星历数据；仅本地差分，禁止入库 |
| `tests/fixtures/jupiter-sun-orb.dyn` | 2548 | `9e69166cf390e6713d6b345a9941d0f7efb7c2a42517b826005ee71574d38f43` | 同上 |
| `tests/fixtures/mercury-sun-orb.dyn` | 2692 | `e6a1587170f94a2e87be179364228b675108d4ae5099e4bff4ffd6e523b80fd6` | 同上 |
| `tests/fixtures/earth-ori.dyn` | 204 | `bb6b0384b9b0c17f2ed49b1b458758dbd731e1b3e27477afdc6a11fe9d0bd877` | 同上 |
| `tests/fixtures/sc_juice-orb.dyn` | 3268 | `840449a706e20d126ad87257b50df988f625b758e67235c6482faad775f45844` | 同上 |
| `tests/fixtures/sc_lucy-quat.dyn` | 1045 | `bb650f52709c7f8ad1014162b428b3a1d14a18d96730c4e229ba01395fce853c` | 同上 |
| `tests/fixtures/sc_europa_clipper-orb.dyn` | 1036 | `595c82836fe15c3669419459bd37d773b1f31d40961fa70bc12ee6668f3ecfa0` | 同上 |
| `tests/fixtures/sc_osiris_rex-orb.dyn` | 4268 | `03beb285e34bae604f9312404b7ba4737cd4252b42ffe0af0b063eef4548fbae` | 同上 |
| `tests/fixtures/sc_biosentinel-orb.dyn` | 748 | `0464de2f4e3c2d469980e3addf7d379aa4b4cc70e2f142be12615f277267e0f2` | 同上 |
| `tests/fixtures/sc_stereo_ahead-orb.dyn` | 1612 | `6e02256298ebf1b76a6856fee835da4deccd7b34fe902937b42ba6a677d6f1fd` | 同上 |
| `eyes/src/dyn/starlink/**/def.dyn` | 各 21572 | 未纳入本轮复用审查 | Starlink 数据；不复制 |
| `eyes/src/models/starlink/*.glb` | 43532–53332 | 未纳入本轮复用审查 | 模型资产；不复制 |

真实样本即使只用于本地差分，也不得进入 Git 历史、测试制品、截图基线或插件包。若将来确认 NASA 数据可再分发，需要新增独立来源记录、署名与有效范围说明，并重新评估摘要与体积。

## 4. 已核验的格式事实

以下为用于独立实现与样本编写的行为事实，不复制参考实现的表达。

- 所有标量小端；浮点为 IEEE-754 binary64。
- 文件头：`i16 version`（1 或 2）→ NUL 结尾字符串 `name`（`orb`/`pos`/`lin`/`ori`/`quat`）→ 版本 2 额外 `u8 numberOfDigits`。
- `orb` 在类型头后追加两个 `f64`：`GM_primary`、`GM_central`；其它类型无额外字段。
- 随后 `u8 hasPoints`：1 表示内联点，0 表示索引（或多段）。
- 内联：`i32 count` 后紧跟 `count × stride` 字节；剩余字节必须精确等于 `count × stride`，否则拒绝。
- 索引：`i32 segmentCount` 后每段 `f64 startTime`；版本 1 再读显式 `f64 endTime`，版本 2 只读起点并由下一段起点闭合，末段终点为 `+∞`。
- 分段文件（`<name>_<NNN>.dyn`）没有文件头：`u8 hasPoints`（必须为 1）→ `i32 count` → `count × stride` 记录，类型、版本与 GM 由索引文件提供。

记录布局：

| 类型 | 字段顺序（全部 f64） | 步长 |
|---|---|---:|
| `orb` | time, a, e, n, M₀, qw, qx, qy, qz | 72 |
| `pos` | time, px, py, pz, vx, vy, vz | 56 |
| `lin` | time, px, py, pz | 32 |
| `ori` | time, qw, qx, qy, qz, ωx, ωy, ωz | 64 |
| `quat` | time, qw, qx, qy, qz | 40 |

关键约定：

- 四元数在文件中为 **W 在前**（`w, x, y, z`）。按 `x, y, z, w` 读取会错误旋转整个轨道面，这是必须在测试中固定下来的语义。
- 时间单位为秒，参考实现以 J2000 为参考；位置 km，速度 km/s，角速度 rad/s，角度 rad。SPACEEYES 尚未冻结 TT/TDB/UTC 与历元定义，见 §7。
- 样本时间必须严格递增；求值器拒绝重复、乱序或非有限样本。
- 至少需要两个同类型样本才能求值；查询端点允许，区间外不推断。

## 5. 求值语义事实

这些是参考实现的已核验行为，用于差分对照；SPACEEYES 可以在自己的错误码与 API 下重新实现，但不得在未对照的情况下声称“兼容”。

- 区间：有效查询区间是窗口覆盖与实际样本覆盖的交集；端点可查询，区间外返回不可用，不外推。
- 选段：内部样本时刻选择其后一段作为区间；末样本选择最后一段。
- `pos`：三次 Hermite 位置插值，速度取同一多项式的解析导数。
- `lin`：位置线性插值，速度取该段割线速度（常数）。
- `quat`：最短路径四元数 SLERP；参考实现以 0.9995 为线性/球面切换阈值，角速度为零。
- `ori`：两端四元数先按 `q · conj(axisAngle(ω, Δt))` 投影到查询时刻，再做 SLERP；角速度方向-长度分别 SLERP 后取反，并旋转到结果姿态。
- `orb`：两端轨道根数分别投影到查询时刻，再线性混合位置与速度。椭圆平均近点角折回 `[-π, π)`；双曲线以正半长轴幅值表示。开普勒方程迭代上限 20 次、修正阈值 `0.00174532925 rad` 是参考实现的源兼容选择，不是精度承诺。
- 重心选择：省略 `body` 表示相对父级；`body=1` 乘 `μ₂/(μ₁+μ₂)`；`body=2` 乘 `−μ₁/(μ₁+μ₂)`。非法质量比拒绝。
- 拒绝条件：抛物线、负偏心率、非正半长轴、迭代不收敛、零/非有限四元数、非有限输出，均返回明确不可用状态。

SPACEEYES 不复制参考实现的数值阈值作为“科学正确”的依据；若采用相同阈值，必须在插件技能书中标注为差分兼容选择。

## 6. 五类合成黄金样本

合成样本在测试代码内按固定字节布局生成，不提交二进制夹具。它们验证解析、插值、四元数顺序、分段与错误路径；不验证真实天体位置或科学精度。

### 6.1 `orb`（椭圆、单位圆）

文件：版本 2，`orb`，GM₁=GM₂=1，两个样本，根数相同：`a=1`、`e=0`、`n=1`、`M₀=0`、`q=(w=1,x=y=z=0)`；时刻 `0` 与 `2π`。

| 查询时刻 | 期望位置 (km) | 期望速度 (km/s) | 容差 |
|---|---|---|---|
| `0` | `(1, 0, 0)` | `(0, 1, 0)` | `1e-12` 绝对 |
| `π/2` | `(0, 1, 0)` | `(-1, 0, 0)` | `1e-12` 绝对 |
| `1` | `(cos 1, sin 1, 0)` | `(-sin 1, cos 1, 0)` | `1e-12` 绝对 |

### 6.2 `pos`（匀速直线）

版本 2，两样本：`t=0, p=(0,0,0), v=(1,0,0)` 与 `t=10, p=(10,0,0), v=(1,0,0)`。

| 查询时刻 | 期望位置 | 期望速度 |
|---|---|---|
| `0` | `(0,0,0)` | `(1,0,0)` |
| `5` | `(5,0,0)` | `(1,0,0)` |
| `10` | `(10,0,0)` | `(1,0,0)` |

Hermite 在该组端点下退化为精确直线，容差 `1e-12`。

### 6.3 `lin`

版本 2，两样本：`t=0, p=(0,0,0)` 与 `t=2, p=(4,2,0)`。

| 查询时刻 | 期望位置 | 期望速度 |
|---|---|---|
| `0` | `(0,0,0)` | `(2,1,0)` |
| `1` | `(2,1,0)` | `(2,1,0)` |
| `2` | `(4,2,0)` | `(2,1,0)` |

### 6.4 `quat`

版本 2，两样本：`t=0, q=identity`；`t=2, q=(w=√2/2, x=0, y=0, z=√2/2)`（绕 Z 轴 +90°）。

| 查询时刻 | 期望姿态 | 期望角速度 |
|---|---|---|
| `1` | `(w=√2/2, z=√2/2)` | `(0,0,0)` |
| `2` | 输入样本 | `(0,0,0)` |

补充：把第二个样本写成 `−q`（`w=-√2/2, z=-√2/2`），`t=1` 结果必须与上表相同，验证最短路径。

### 6.5 `ori`

版本 2，两样本：`t=0, q=identity, ω=(0,0,π/2)`；`t=2, q=identity, ω=(0,0,π/2)`。

| 查询时刻 | 期望姿态 | 期望角速度 |
|---|---|---|
| `0` | `identity` | `(0,0,-π/2)` |
| `1` | `identity` | `(0,0,-π/2)` |
| `2` | `identity` | `(0,0,-π/2)` |

说明：两端投影分别为 `−(π/2)t` 与 `+(π/2)(2−t)`，在任一查询时刻相差 180°；SLERP 结果落在 `identity`。该样本固定“`q · conj(axisAngle(ω,Δt))` 方向”与角速度取反，**不**验证一般姿态插值。补充样本：`t=0` 为 `identity` 且 `ω=(0,0,0)`，`t=2` 为绕 Z 轴 +90° 且 `ω=(0,0,0)`；查询 `t=1` 期望绕 Z 轴 +45°、角速度零，用于验证非退化 SLERP。

### 6.6 结构样本

| 场景 | 设计 | 期望 |
|---|---|---|
| v2 索引 | 3 段起点 `-50, 0, 100` | 终点 `0, 100, +∞` |
| v1 索引 | 每段显式起止 `(-50,0) (0,100) (100,200)` | 保留显式终点 |
| v2 分段文件 | `hasPoints=1`，`count=2`，两条 `pos` 记录 | 解析为同类型点，无文件头 |
| 重复/倒序时间 | 两个样本同一时刻或后一时刻更小 | 求值返回不可用，不猜测 |
| 字节数不符 | 声明 count 与剩余字节不匹配 | 解析拒绝 |
| 未知版本/类型 | `version=3` 或 `name="xyz"` | 解析拒绝 |
| 零四元数 | `w=x=y=z=0` | 求值拒绝 |
| 区间外 | 查询早于首样本或晚于末样本 | 返回不可用，不外推 |

## 7. 科学边界与未冻结项

- 参考实现的注释以 J2000/TT 描述时间，但 SPACEEYES 尚未实现 TT/TDB/UTC 转换、闰秒或历元权威对照。不得把 DYN 的 time 字段直接当作已验收的科学时间。
- 参考系命名、父级路径语义、GM 来源与单位校验尚未冻结；插件必须显式声明，不能从路径字符串猜测。
- 合成样本只证明机制；真实科学验收需要权威星历（NASA/JPL 或等价来源）、明确误差容限与覆盖范围。
- NASA 数据域名、缓存与网络预算必须经宿主代理；插件不得直接读取核心私有状态或绕过权限。

## 8. M4/P04 进入条件

- [x] 固定参考提交、逐文件摘要与许可分类；
- [x] 自研 TS 复用边界与恢复源码/NASA 数据排除决定；
- [x] 五类点、分段、四元数顺序、求值与错误语义的格式证据；
- [x] 合成黄金样本设计与容差；
- [ ] 上游书面许可或法务确认（当前仅有 `package.json` 声明，无 `LICENSE` 文件）；
- [ ] NASA 数据再分发/缓存条件确认，或明确长期仅本地差分；
- [ ] TT/TDB/J2000 与参考系命名 ADR；
- [ ] 最小受限插件宿主（P03）的能力、权限与资源所有权；
- [ ] 真实五类样本的固定摘要、有效范围与独立科学误差验收；
- [ ] 插件 SKILL.md、Proto 映射与停用清理。

## 9. 本轮验证与后续

本增量已完成解析、求值、分段加载与有界缓存，代码位于`packages/nasa-dynamo`，包内24项合成测试、严格TS构建、prettier与policy通过；按用户新指令不做逐次全量，整体回归留待批量完成后统一执行。受信浏览器宿主的`?scene=solar`经只读`/api/dynamo`代理显示太阳/地球/月球/火星/木星，位置按1 km=1e-6 m显示压缩；真实NASA数据、权限沙箱、时间/参考系换算与真实科学样本仍待后续。

后续顺序：最小受限插件宿主P03、时间/参考系ADR，然后把`packages/nasa-dynamo`接入宿主代理并补权限/停用/网络失败负向测试；真实样本差分维持在贡献者本地，直到 §8 的许可条件满足。
