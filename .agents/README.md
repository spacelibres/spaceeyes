# Bevy 技能来源与应用范围

来源：https://github.com/chrisgliddon/bevy-skills
固定提交：b1b4da5744ebbd5c526342b2351967411cd5ca61
许可：MIT，原始许可全文见 BEVY-SKILLS-LICENSE。

已通过 skill-installer 安装全部 31 个技能目录到本项目 `.agents/skills`，包含上游参考资料、辅助脚本和测试。仅移除了 `bevy-ecs-systems/references/system-params.md` 一行末尾的两个空格以通过差异检查，其他上游内容保留。按任务选用，不代表采用所有功能或依赖。

技能内容当前面向 Bevy 0.19；项目实际版本仍须在实施设计时单独确定。入口为 skills/bevy/SKILL.md，项目适用边界见根目录 AGENTS.md。

更新时先审查上游差异、版本适用性和许可，再替换固定快照并复验。不得自动跟随 main 或覆盖本项目架构。

## 太空之眼自有技能

`skills/spaceeyes-nyx/SKILL.md` 是项目编写的 Nyx 科学计算技能书，含上游来源与专项验证清单；采用 MIT，不属于上面 31 个上游 Bevy 技能。Nyx、ANISE、Hifitime 依赖保留各自许可。
