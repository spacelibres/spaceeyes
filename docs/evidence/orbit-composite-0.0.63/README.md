# 0.0.63 NASA轨道混合修正

## 源码依据与修复范围

本地NASA源码LineShader.js、TrailShader.js properties：transparent=true、depthWrite=false、blending=additive。TrailManager.js规定八行星RGB、primary .75/secondary .35/hover 1，解析轨道1.2/2px，拖尾0→2与2→4px。

此前Gizmos使用ALPHA_BLENDING并写入深度，压暗亮银河的机制与NASA不同。现使用一个持久mesh/material的像素宽线批次：RGB为SrcAlpha/One/Add，alpha保持背景，不写深度但保留深度比较，完全透明区间不提交，外置trajectory.wgsl由服务器加载。NASA Color/LineMesh直接传递原始RGB；追加回归实证旧sRGB解码把(.6,.4,.2)降成(.3185,.1329,.0331)，已改为原值GPU上传，并去掉重复片元抗锯齿透明覆盖，边缘由相机MSAA处理。NASA RGB是显示编码，不改变物理表面色。先前银河排序反了的猜测已通过Bevy源码排除，未修改负排序偏置。

user-reported.png是用户原始截图；before-oblique.png是旧构建另一机位实测，二者均不冒称与新截图同机位。interim-overview.png是原值RGB修正前的中间观察记录；after-top.png、after-galaxy.png来自最终0.0.63 WASM。page-assets.json确认实际加载trajectory.wgsl，非仅TS更新。

## 检查

完整check-core命令包含Renderer/ReleaseWasm/Workspace/NativeCamera及真实样本、Juno/Solar资源，exit=0，见checks.log：158平台验证、16WASM、2真实DYN、62网页、52宿主、118原生渲染。轨道原始RGB与混合契约在旧行为上先失败；新行为通过。新增无深度写入但保留遮挡、零透明不上传、宽度渐细和复用单mesh/material测试。

实际GPU：太阳系总览与亮银河中彩色轨道显示；轨道开关前后无原先整条黑划痕，地球82/86对象场景及白色拖尾，四项源覆盖缺失没有伪造。480倍播放从846724111.392前进到846765674.256，随后正常暂停；after-earth-trails.png记录近景。最终错误/警告日志为空，见browser-logs.json。独立审查发现近裁剪固定插值偏移可能放大缺口，已改精确交点并复审无其他明确缺陷。

## 像素对照和边界

galaxy-orbits-on/off.png为同相机/暂停TDB=846765794.256、临时关闭星点和标签的实际开关截图。pixel-comparison.json如实保留ROI及局部RGB升降数量；HDR色调映射/抗锯齿后的最终像素并非逐通道单调，因此不把“所有最终像素都不降低”报告为通过。独立核验的是NASA加法混合契约与实际画面，不是校色认证。测试后已恢复星点、标签、轨道和拖尾开关。

每帧仍更新CPU顶点及mesh数据，句柄复用测试不能证明长期GPU/内存峰值稳定。未认证所有设备、全NASA功能及所有科学精度；保留后续全局差距矩阵，不因本轮修复删减其它能力。
