# 卫星相机回归 0.0.46

核心0.0.38、网页0.0.46。完整命令check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets通过，日志validation/results/orbital-camera-0.0.46-checks.log：127平台、14真实WASM、2真实DYN、50网页库、40宿主、90原生渲染，加62个表面/环资源及Next构建。

新回归覆盖高速轨道时间推进不触发主星碰撞、真正用户移动仍防穿透、小目标far包含主星、移动目标过渡、NASA横竖屏长边FOV、Follow目标在画框内和加载时暂停。失败先复现再修正，独立只读复审无P1/P2。

实际浏览器从用户MRO链接TDB847045665.6641246、57600倍率启动。模型持续保持中心；跨覆盖段可暂停，暂停后时刻保持。主星火星仍按真实轨道位置显示，近轨视角其视直径大于视场时填满背景属于尺度结果，未缩小主星伪造小球。可见相机诊断记录expected/actual位置及collisionAdjusted，截图与JSON同目录。

注意：高速推进到部分未来时段时MRO姿态源不覆盖，面板明确提示，不把缺姿态称为真实姿态；未在本次伪造补齐源数据。截图不替代全量NASA视觉、科学轨道误差或长时性能认证。


MRO可见诊断两次采样覆盖2026-11-14至11-19，实际positionKm=desiredKm、collisionAdjusted=false、desiredInside=[]（mro-camera.json）。加载时暂停后同一时刻维持，随后切Follow确认参考火星。期间Mars Express未来段源失败仍明确展示，未隐藏真实缺数据错误。


最终构建Chandra：TDB969190029.2040576、FOV100、Follow参考earth，chandra-earth-follow.png显示主星居中及完整航天器；NASA长边FOV与几何比例按回归保持。Nearby允许主星离开视野，主星锁定使用Follow，未把两模式混为同一操作。MRO Follow偏移最终按视场约束，竖屏及窄FOV也有原生投影回归。实际console error/Bevy ERROR为空。
