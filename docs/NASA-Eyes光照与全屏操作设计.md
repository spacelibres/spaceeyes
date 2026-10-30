# NASA Eyes光照与全屏操作设计

全局路线第四批。用户已授权按平台大纲连续实施，维持Bevy显示核心、受控SDK和Next宿主边界。

NASA CameraManager保留太阳灯，natural关闭相机补光、shadow弱补光、flood强补光；shadow不是阴影开关。新增camera.lighting(mode)同步受控意图，仅natural/shadow/flood，camera.control权限。Core.set_camera_lighting(session,plugin,mode)，camera_lighting()->&str；WASM camera_lighting(session,plugin,mode) setter，camera_lighting_mode() getter。Core记录owner，释放恢复natural。非法值拒绝不修改。SDK CorePort cameraLighting，WasmCorePort精确转发。全部不暴露Bevy Transform。

太阳灯SolarDirectionalLight与CameraFillLight独立标记，太阳更新不触及补光。最终相机碰撞后同步辅助光方向，照度0/.15/1倍现有太阳照度，属于渲染参数映射而非物理照度等价声明。太阳自发光、外置银河IBL及真实科学位置不改变；标准PBR接受补光。环自定义着色器仅按现有物理太阳方向，不假称自动收到PBR补光。

全屏属于宿主显示操作，直接用户点击调用容器Fullscreen API，fullscreenchange事件反映实际状态；拒绝/不支持明确反馈，ESC恢复，卸载和退出清理。保留spacelibre品牌及响应式布局。其能力不进入科学时钟或插件权限。

验收Core/SDK权限、枚举、释放、真实WASM转发；原生App移动相机/原点后辅助灯方向及太阳独立性；实际GPU对照natural/shadow/flood地球暗面与航天器，太阳不受照；全屏进入/ESC/resize和失败路径。版本、CHANGELOG、完整检查、提交推送与gh状态按既定规则。
