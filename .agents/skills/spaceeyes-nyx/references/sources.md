# 上游依据

核对日期：2026-10-28。以下为调研快照，不代表已经选择依赖版本。实际 API 和 features 以项目锁定版本的源码为准。

| 项目 | 核对提交 | 官方入口 |
|---|---|---|
| Nyx | d1c3598d5ccf4c984a1d3dd82c450e2af363e821 | https://github.com/nyx-space/nyx |
| ANISE | 495f41dc9139fce43deda137a865486ea8a53a89 | https://github.com/nyx-space/anise |
| Hifitime | 89c30531fbab6afde0501fc5c4e027d7a3f22696 | https://github.com/nyx-space/hifitime |

Nyx 核对依据：
- README：https://github.com/nyx-space/nyx/blob/d1c3598d5ccf4c984a1d3dd82c450e2af363e821/README.md
- 工作区声明：https://github.com/nyx-space/nyx/blob/d1c3598d5ccf4c984a1d3dd82c450e2af363e821/Cargo.toml
- 核心功能开关：https://github.com/nyx-space/nyx/blob/d1c3598d5ccf4c984a1d3dd82c450e2af363e821/nyx-core/Cargo.toml 。已核对该快照 default = ["premium"]；实际接入仍须核对锁定版本，不据此自动启用或推断授权。
- 官方文档入口：https://nyxspace.com/ 和 https://docs.rs/nyx-space/

Nyx 上游 README 声明参与 Blue Ghost 1 与 NASA/Advanced Space CAPSTONE。ANISE 上游 README 声明用于 Blue Ghost 的任务运行。引用这些经历时注明组件与来源，不能表述为太空之眼或任意配置已经通过 NASA 认证。

版本升级时重新核对许可证、features、API、时间/参考系行为和数值回归。避免只按 latest 文档编写锁定旧版的代码。

本技能是项目原创 MIT 文本，链接的上游代码与资料保留各自许可证，不复制其代码或改变授权。
