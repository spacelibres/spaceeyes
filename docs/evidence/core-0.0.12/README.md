# 0.0.12 缩放限制修复

问题：update_focus 每帧把相机距离钳回完整球体所需的 FOV 距离；输入另有限制 1.2，下限叠加导致放大停止。原生测试先将距离设为 1.05，旧实现实际仍在完整取景位置，失败记录 validation/results/zoom-red.log。

修复后，切换目标/视角/重新聚焦才应用完整取景；手动缩放继续进入局部视野，表面碰撞边界及近裁剪单独处理。环只影响初始取景，不把整个环范围当成实体球面。

完整检查 tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets 退出 0，日志 validation/results/core-0.0.12.log，98 项不同自动测试通过。

真实浏览器键盘选地球后，在画布坐标 (610,350) 使用实际滚轮 up 3 页，可从完整球体接近表面（before.png、near-surface.png）；down 0.5 页立即缩小至可见局部大陆（local-view.png），随后调用聚焦恢复取景。没有用脚本直接修改相机状态。

此证据证明原限制已解除，不是与 NASA Eyes 的同视角成对验收。当前固定表面纹理近景模糊，尚无表面 LOD、地形或地标细节；缩放节奏、自动目标转移及完整 NASA 相机一致性尚待对照，不宣称全部完成。
