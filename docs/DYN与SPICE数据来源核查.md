# NASA Eyes DYN 与 JPL SPICE 来源核查

核查日期：2026-11-09。本文区分已经取得的证据、合理推测与尚未确认的环节。

## 结论

NASA Eyes 与 JPL 的 SPICE 生态存在明确关系，但目前没有掌握官方 DYN 生成管线、每条轨迹所用内核清单或逐文件溯源信息，**不能断言所有 DYN 都是从某个 BSP 文件转换的，也不能把 DYN 的分层直接等同于相机距离 LOD**。

- JPL NAIF 2016 年的 [SPICE 应用报告](https://pds-engineering.jpl.nasa.gov/wp-content/uploads/NAIF_Performance_Review_2016.pdf) 将 Eyes on the Solar System 列为 SPICE 的可视化和科普应用。这是 Eyes 使用 SPICE 的历史证据，不是当前所有 DYN 的逐文件来源证明。
- NASA 2026 年 [Eyes 更新说明](https://science.nasa.gov/blogs/eyes/2026/04/29/nasas-eyes-software-april-release-notes/)称 Artemis II 轨迹由任务团队更新后接入，并说明其姿态近似处理未接收实时遥测。这说明至少部分内容可来自任务团队，而且显示结果不能一律当成实时测量。
- 本项目此前用地球一个 DYN 真实端点，对照 JPL Horizons 给出的 DE441、地球相对太阳、ICRF、几何位置，同一名义 TDB 历元位置相差约 4.883 米。详细输入和限制见 [DYN 科学语义核对](DYN科学语义核对.md)。单个样本的接近程度不能证明转换关系、内核版本、其他时段精度或姿态来源。

可以把可能的数据流程理解为 `科学星历和任务数据 → 数据加工（细节未证实）→ Eyes DYN → 按时间检索和插值 → 三维显示`；箭头是工作假设，不是官方发布的生成流程。

## BSP 和 DYN 的区别

| 项目 | SPICE SPK（常见扩展名 .bsp） | 已核查的 Eyes DYN |
| --- | --- | --- |
| 作用 | 提供天体或航天器相对于参考体的位置、速度星历，具体插值表示依 SPK 类型而定 | 为 Eyes 控制器提供按时间读取的运动、姿态等数据 |
| 结构 | SPK 按对象、参考系和时间覆盖组织片段，支持多种数据表示 | `def.dyn` 及下级 `.dyn` 文件构成按时间区间查找的树，叶节点含样本 |
| 求值 | 不同 SPK 类型可使用切比雪夫、多项式等方法 | 本地恢复的控制器中，位置样本使用位置与速度插值，轨道根数和姿态等分别处理 |
| 姿态 | 单个 BSP 不负责覆盖全部姿态信息；SPICE 另有 CK、PCK 等内核类型 | DYN 存在姿态数据，实际来源未逐对象证实 |

SPK 定义参见 [NAIF SPK 文档](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/MATLAB/req/spk.html)，航天器/仪器指向和天体方向模型分别参见 [CK](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/ck.html) 与 [PCK](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/pck.html)。这些文档说明 SPICE 能力，不证明 Eyes 每份 DYN 一定采用了相应内核。

本地恢复版本的 `solarsystem/eyes/src/engine/controllers/DynamoController.js` 展示了点集的时间范围、子文件加载以及按时间选择；恢复代码用于解释已观察行为，不代表已获得 NASA 内部完整生成源码。分层按时间服务于数据检索，尚无证据说明层级按屏幕尺寸或相机远近选择。

## 对本地资源的含义

1. 本地保存 DYN 及索引可支持已有 Eyes 数据的离线显示；时间覆盖、来源版本和异常必须逐项保留，不因脱机而凭空补全。
2. BSP 是另一类可独立核验和计算的数据源，不能把 DYN 重命名成 BSP 或假设二者字节、插值算法一致；未来若接入 BSP，应保留具体文件、散列、版本、参考系、时间尺度和覆盖区间。
3. 要确认某个 DYN 是否由特定 BSP 生成，需要获取官方生成说明或可追溯的内核清单，并在多个时刻、段边界和段内对位置、速度及适用姿态进行比较；数值接近仍不单独构成生成关系证明。
4. DYN 展示与未来服务器端 Nyx/SPICE 科学计算应保持独立边界；未完成误差和来源验证前，不能把可视化近似描述为科学级实测。
