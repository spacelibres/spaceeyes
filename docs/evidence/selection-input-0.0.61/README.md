# 选择天体后画布输入修复

web0.0.61，core0.0.49/SDK0.0.36。完整check-core（Renderer/ReleaseWasm/Workspace/NativeCamera、真实DYN、离线资源）exit0；62网页、52宿主集成、113原生渲染等通过，checks.log归档最终运行。独立审查无明确回归，要求实机复验原地滚轮与面板隔离。

## 修改前真实复现

00-before-stationary-wheel.json：总览鼠标停在(640,360)点击太阳，自动打开的信息面板把DOM焦点移至“关闭对象信息”。在同一坐标直接原生滚轮down1，Sun相机positionKm与desiredKm均保持[0,-3984492.3691749573,0]。没有用脚本合成事件或修改页面状态。

## 实机验证

01–05是首版修复证据：自动信息面板保留canvas焦点，同位滚轮正反有效；倍率2.05443305099，对照exp(0.72)=2.05443321064，反向回到原范围，未重复消费。目录选择后即使焦点仍在button也能通过SDK缩放；侧栏scrollTop0→655且相机严格不变，按钮、拖动和木星系统有效。

最终补充wheel显式focus(canvas,preventScroll)以恢复正常焦点渲染节奏，随后重新完整检查和重启生产构建。06-final-focus-wheel.json记录目录选水星后首次画布滚轮恢复CANVAS焦点并移动相机；07记录面板scrollTop0→720且相机严格不变；08是在同一(640,360)点击太阳后立即滚轮的结果，相机到[0,-8185872.814655304,0]，不需要先移动鼠标；09月球选择后滚轮有效；10按钮与直接拖动均改变相机，附最终截图/UI。

errors.json和passive-warnings.json最终均空。宿主监听先阻止事件继续到winit，只用已有受控camera.zoom，不放开Rust焦点/拖动中断保护；HTML面板wheel不preventDefault，也不转移焦点。单位测试覆盖像素/行/页、方向、SDK[-1,1]、零值/非法值和下游监听器不能双算。实际触屏设备与所有浏览器仍未认证，不能将本次输入回归说成全部NASA功能已完成。
