# NASA Dynamo → SpaceEyes Rust/Proto 迁移与验证规范

版本：0.0.0｜状态：待审

## 事实来源
参考实现：spacelibres/solarsystem/main/src/lib/dynamo/{reader,parse,math,orbit,loader}.ts；更完整的科学求值见src/solar/domain/ephemeris.ts，运行时见src/solar/runtime/explorer-runtime.ts；参考docs/solar-system/ephemeris.md、ephemeris-failures.md与tests/dynamo.test.ts。迁移时须固定具体commit SHA和黄金样本SHA。

## 已有结构
DYN v1/v2小端格式；点类型orb(72B)、pos(56B)、lin(32B)、ori(64B)、quat(40B)；四元数磁盘顺序w,x,y,z；内联记录及分段索引。源代码有真实数据测试，但各类型覆盖程度不同。

## 迁移规则
1. 先建立样本、源提交、字段映射、来源与许可台账。
2. Rust parser按模块化对象封装；对异常长度、空段、非法索引、重复/逆序时间显式报告。
3. 不仅迁移parse.ts；必须研究独立ephemeris求值器的五种语义、边界和缺失数据状态。
4. 保留原始记录顺序与冲突时间的选择语义，不盲目排序、去重或跨跳变插值。
5. 规范化时间尺度、参考系、单位、父级关系、有效范围、数据源与校验摘要后再Proto编码。
6. Rust与TS对同一黄金样本输出进行对照；按NASA/JPL独立参考数据设置可解释误差阈值。
7. 数据包需索引/分块；Protobuf本身不提供随机访问文件布局。

## 验收
所有五种类型、内联与分段、重复边界、损坏文件、跨语言Proto往返、缺失数据和版本不兼容均有可重现测试。未完成验证的类别不得声称完全支持。