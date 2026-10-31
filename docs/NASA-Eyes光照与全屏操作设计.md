# NASA Eyes光照与全屏操作设计

全局路线第四批。用户已授权按平台大纲连续实施，维持Bevy显示核心、受控SDK和Next宿主边界。

NASA CameraManager保留太阳灯，natural关闭相机补光、shadow弱补光、flood强补光；shadow不是阴影开关。新增camera.lighting(mode)同步受控意图，仅natural/shadow/flood，camera.control权限。Core.set_camera_lighting(session,plugin,mode)，camera_lighting()->&str；WASM camera_lighting(session,plugin,mode) setter，camera_lighting_mode() getter。Core记录owner，释放恢复natural。非法值拒绝不修改。SDK CorePort cameraLighting，WasmCorePort精确转发。全部不暴露Bevy Transform。

太阳灯SolarDirectionalLight与CameraFillLight独立标记，太阳更新不触及补光。最终相机碰撞后同步辅助光方向，照度0/.15/1倍现有太阳照度，属于渲染参数映射而非物理照度等价声明。太阳自发光、外置银河IBL及真实科学位置不改变；标准PBR接受补光。环自定义着色器仅按现有物理太阳方向，不假称自动收到PBR补光。

全屏属于宿主显示操作，直接用户点击调用容器Fullscreen API，fullscreenchange事件反映实际状态；拒绝/不支持明确反馈，ESC恢复，卸载和退出清理。保留spacelibre品牌及响应式布局。其能力不进入科学时钟或插件权限。

验收Core/SDK权限、枚举、释放、真实WASM转发；原生App移动相机/原点后辅助灯方向及太阳独立性；实际GPU对照natural/shadow/flood地球暗面与航天器，太阳不受照；全屏进入/ESC/resize和失败路径。版本、CHANGELOG、完整检查、提交推送与gh状态按既定规则。

第八批核对恢复源 Settings.js:203，NASA默认选择shadow。宿主启动显式设置shadow；省略light的场景链接同默认。释放仍恢复核心natural，显式链接light参数保持原值。


## 0.0.45 WebGL自然光修复

实际浏览器复现：natural地球整体发黑；Bevy light.rs:1135日志明确2方向光超过上限1。锁定0.19.1的bevy_pbr render/light.rs:215-216在WebGL WASM上MAX_DIRECTIONAL_LIGHTS=1，原生为10；因此原生双灯数值测试未覆盖浏览器截断。太阳与补光不能同时采用DirectionalLight。

保留唯一SolarDirectionalLight；CameraFillLight改PointLight并与碰撞后的最终相机位置同步，natural为零通量。shadow/flood按原1500/10000目标中心照度映射：显示坐标中r为相机距浮动原点的距离，Φ=4πEr²，range=64r，关闭阴影。它是可视化辅助光、存在逆平方近远变化，不冒充天文太阳照度；不改太阳方向、科学位置、曝光或背景亮度。有限显示距离保护1e-8..1e8避免极端溢出。标准PBR接收，环的独立着色仍原方向。

回归必须核对实际setup仅1盏方向光、模式与浮动尺度、相机位置/旋转同步、太阳独立。浏览器核对自然光亮面、真实暗面、补光两档和无directional超限警告，完整检查后版本/CHANGELOG/提交推送/gh。
