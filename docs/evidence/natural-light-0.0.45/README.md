# WebGL自然光修复 0.0.45

核心0.0.37，网页0.0.45，SDK接口不变。基线a0bb131d6。实际浏览器复现natural地球整体暗，日志：The amount of directional lights of 2 is exceeding the supported limit of 1。锁定Bevy0.19.1 render/light.rs WebGL MAX_DIRECTIONAL_LIGHTS=1，原生为10；原双方向光导致浏览器可能仅保留零通量相机灯、丢弃太阳灯。

太阳保留唯一方向光，相机辅助灯改无阴影PointLight；按当前显示距离平方映射通量，natural=0，shadow/flood目标中心照度1500/10000。辅助灯是显示效果，不是天文光源；太阳光照方向、科学位置、曝光、背景未改变，夜面仍应保持暗。

测试先复现旧实现不更新PointLight失败，再修复通过；新增实际setup方向光仅1、点辅助灯1，三模式/太阳独立、最终相机同步和四种显示尺度照度不变回归。完整检查记录validation/results/natural-light-0.0.45-checks.log。独立复审未发现P1/P2，像素验证单独记录。


实际GPU：before-earth.png与after-earth-same-view.png为同TDB846678154.211/side视角，修复后出现真实受光边缘。front视角earth-natural.png可见蓝色亮面及暗面；earth-shadow.png/earth-flood.png记录两档辅助照明，背景不随模式整体提亮。iss-natural.png确认标准glTF模型受太阳光照；console error、Bevy ERROR、directional超限日志全部为空。退出回到“工作区已释放”。一次DOM读取超时后截图与后续读取恢复，不计为场景失败。

完整检查全部通过：127平台、14真实WASM、2真实DYN、50网页库、39宿主集成、86原生渲染；62个表面/环资源检查及Next生产构建通过。未将本次截图称为全量NASA视觉或长时性能验收。
