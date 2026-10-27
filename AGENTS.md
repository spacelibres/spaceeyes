# SPACEEYES 开发约束

版本：0.0.1｜依据：用户要求及项目已批准规范

遵循docs/项目文档与版本规范.md、已批准ADR和开发进度路线；视觉工作使用用户指定spacelibre VI。核心保持Rust唯一权威，公开结构化接口使用Proto，SDK能力同步技能书。

## 强制本地与GitHub CLI双重交付门槛

每次变更先通过完整`bash tools/check.sh --gpu`，再创建候选提交；不允许把本地通过当成远端通过。

候选提交只能先推送`development/verify-*`验证分支。使用GitHub CLI等待同一完整SHA的Rust Core CI的push事件结束，执行`python tools/verify_remote_ci.py --run-id <运行ID> --sha <完整SHA>`核验核心/GPU作业及必需步骤全部成功。PR事件可能测试合并树，不接受为候选SHA证据。失败、跳过、取消、未结束、缺作业或SHA不符都不得向开发分支交付。

只有同一候选SHA本地和远端均通过，才能fast-forward合入并推送开发分支。验证后不可amend、squash或修改文件再沿用旧结果；任何变化都重新验证。开发分支自身推送触发的CI也必须经gh核验后，才报告本轮交付完成。禁止绕过、降低测试标准或直接推送未经远端验证的新提交。

远端CI需要已存在的Git提交，因此候选提交是验证载体，不视为已经交付。最终报告必须附实际CI链接与提交SHA；不修改仓库保护设置，不把验证分支的失败历史隐藏掉。
