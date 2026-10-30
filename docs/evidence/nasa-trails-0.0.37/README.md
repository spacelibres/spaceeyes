# NASA全局对齐第一批：卫星拖尾与正确性

core0.0.31 / SDK0.0.26 / web0.0.37。分支codex/bevy-planning；冻结分支未修改。

## 检查

最终完整命令`pwsh -NoProfile -File tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets`退出0。99项平台/验证、9项真实WASM、2项真实DYN、42项网页库、19项工作区集成、74项本地渲染测试，Rust Clippy/格式、发布WASM、Next生产构建、62份表面/环资源全部通过。日志validation/results/nasa-parity-0.0.37-checks.log。

新增测试覆盖过去窗口/未来裁剪/断口/头尾透明度、原子注释、SDK到WASM真实传输、普通轨道兼容、父体随时间运动、活动请求取消并立即重试、独立拖尾开关和导航保持播放。测试发现并修复了WASM适配器漏传新字段；未以只通过SDK mock代替真实边界。

## GPU

Intel Arc B390集成显卡、ANGLE D3D11/WebGL2，生产服务器127.0.0.1:3006。实际加载ISS的真实DYN和外置模型，当前场景11/11可用，来源SHA45eee4777551前缀。逐级滚轮从模型近景拉到地球轨道范围，俯视检查头部贴当前卫星、轨迹围绕地球、尾部渐隐；截图iss-trail.png。

实际正播60倍、倒播-60倍、暂停；关闭卫星拖尾时行星轨道保持，重启拖尾；切换月球并拉远，检查地心轨迹与渐隐，截图moon-trail.png。播放中返回总览仍显示暂停按钮及原倒播倍率；error与Bevy ERROR日志两路均空。trail-off.png记录独立开关关闭状态。

## 尚未完成

本批不宣称NASA所有操作习惯一致。Nearby/System/Follow还需独立相机语义、触摸/键盘/缩放按钮、时间轴与LIVE等后续批次。ISS场景中的父体仍可能使用简化球体（截图可见），下一批需按观察场景触发父体表面。完整姿态/部件动画、逐对象科学精度、跨设备长期GPU预算保持未验收。

尾迹有originId时是父体相对历史，非ICRF惯性历史；暂停/倒放依统一科学时刻重算。表面缓存64MiB是缓存持有的生成纹理预算，不是全部场景显存；活跃材质引用不强制删除。NASA官方页面实测控件证据另见../nasa-parity-2026-10-31。
