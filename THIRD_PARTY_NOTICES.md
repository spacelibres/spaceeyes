# 第三方依赖说明

SPACEEYES 原创源码按根目录 LICENSE 的 MIT 许可发布。第三方依赖及 NASA 数据、纹理不因被本项目使用而改为 MIT；具体版本以 Cargo.lock 和 package-lock.json 为准。

## 本轮新增的时间依赖

Hifitime 4.3.1 用于 Rust 核心的 UTC/TDB 转换，包元数据声明为 MPL-2.0。本项目未修改其源码。它不是 Nyx 任务传播器；Nyx 仍只属于后续服务器计算模块。

- 固定版本源码：https://crates.io/api/v1/crates/hifitime/4.3.1/download
- 上游项目：https://github.com/nyx-space/hifitime
- 随网页提供的原始许可证：[MPL-2.0](web/public/licenses/hifitime-MPL-2.0.txt)，运行时路径 `/licenses/hifitime-MPL-2.0.txt`。

分发说明应保留其单独许可和上述对应源码获取方式，不能把 Hifitime 文件标为项目原创 MIT 源码。本页记录本轮新增依赖及许可事实，不声称已经完成所有传递依赖的许可审计。

Bevy 0.19.1 的包元数据为 MIT OR Apache-2.0；默认字体和其他依赖保留各自上游权利。NASA 资产的来源与散列记录在 validation 下的固定资源清单中。
