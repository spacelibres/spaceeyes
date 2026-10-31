# 整体体验基线：未通过NASA整体验收

2026-10-31，应用基线16ed2f585（核心0.0.46/SDK0.0.35/网页0.0.54）。本轮无运行代码变化。

01—21的截图记录同一工作区连续流程；06起另有文本UI记录，前五项UI状态见对应截图。首次暂停TDB846706558.832；ISS倍率操作开始3 sec/s播放，随后暂停在846706762.759，后续切换保持该时刻。

errors-before-exit.json与errors-after-reentry.json均记录36条Rust资产I/O错误，普通浏览器error为空；未解释请求来源，不得报告整体无错误。NASA官方页面DOM曾读取成功，但截图请求超时，未取得有效官方成对截图。

source-surface-channels.json记录NASA表面通道声明及当前材质路径差异，属于已确认来源/实现差距，不作为某次提交回归的证明。截图只证明当前流程及外观，不证明NASA画面一致或科学精度。

checks.log为本轮完整命令输出，仅去除行尾空格：

`pwsh -NoProfile -File tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets`

退出0，142平台/验证、16真实WASM、2真实DYN样本、50网页库、50宿主集成、111原生渲染测试通过。GPU整体结论仍未通过。基线CI41183163701已成功，文档提交自己的CI结果另行查询。

完整结果、误报撤回和跨模块实施门槛见../../NASA-Eyes整体体验基线与批次验收.md。临时NASA标签页和本地验证页已关闭，服务保留在3006。
