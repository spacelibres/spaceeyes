# NASA相机操作闭环验证 0.0.38

2026-10-31，本地生产构建127.0.0.1:3006，真实浏览器Bevy WASM渲染。完整检查日志validation/results/nasa-camera-0.0.38-checks.log通过，含80项原生相机/渲染测试、真实WASM SDK与宿主集成、DYN及模型/表面资源检查。

- 地球Nearby切System后地月系统纳入取景，航天器不参与系统范围放大；earth-system.png。
- 地球保持选中，显式月球参考Follow。方向改变而非重复focus；earth-follow.png。Follow参考祖先链在太阳终止，复测仍80/84，无Observable Universe/Milky Way伪失败。
- 缩放按钮可用，画布聚焦后Home回到Nearby；参考/模式DOM与画面核验。移动参考科学方向变化及碰撞通过原生App集成测试，不将静态截图称为完整动画测量。
- ISS真实模型与父体地球表面同时可见；iss-parent-surface.png。返回总览可用。console error和Bevy ERROR均为空。
- 临时844×390横屏核查后恢复视口；实体触摸设备未测，捏合比例、拖动/点击隔离由纯函数测试验证。
- 地球同场四项目Rumba/Samba/Tango/GRIFEX源数据当前不可用，明确提示；本批未伪造修复来源。冻结分支未操作。

尚未宣称NASA逐像素/全操作一致，时间栏、光照模式、完整内容导航、科学姿态与压力性能仍按全局路线继续。
