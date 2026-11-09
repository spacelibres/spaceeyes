# 相机取景修正证据

版本：核心0.0.58、SDK0.0.48不变、网页0.0.78。冻结分支未修改。

## 来源与数学验证

sources.json记录本地NASA CameraScripts、Cameras、ZoomController、CameraComponent源文件SHA和LRO复现参数。LRO取景radius=0.0038km，科学遮挡半径0.00272km不变；1280×720、长轴FOV45°、TDB846807818.1325184、暂停。

lro-source-state.json是真实服务器数据；lro-diagnostics-before/after-zoom.json来自实际GPU页面。lro-math-verification.json验证：实际镜头距离约21.770053m，与1.3*extentsRadius/sin(短轴FOV/2)吻合；镜头到目标径向与父体相对方向余弦近1；三次缩小实测倍率1.8660649，源码预期2^0.9=1.86606598；碰撞未挤压镜头。不是改变月球半径来凑比例。

## 回归与检查

- red.log：真实原生Bevy应用中父体北向、目录焦点、离地缩放三项先失败。修正测试的场景模式/惯性收敛后重新在旧生产代码上复现，日志为有效断言失败。
- system-red.log：独立审查发现的坐标基不一致先失败，后统一取景和镜头基。
- green.log为首三项修正通过记录；最终native.log及checks.log包含全部149项原生测试。
- 完整检查最终通过：217平台/验证、17基础WASM、2真实DYN、98网页、66宿主、149原生渲染，以及fmt/clippy/TS/ReleaseWASM/Next/资源检查。

## 可视验证与限制

lro-before.png/lro-after.png：同一对象、同一时刻、同一长轴FOV和1280×720，修正前后默认工作区。lro-compact.png另行收起遮挡控件，仅供观察完整模型，不作为同布局像素对比。

保留模型、纹理、关节和科学姿态链；LRO页面明确显示推导姿态，未声称真实ORI姿态已核验。月面近距纹理LOD与NASA在线成对图像验收不在本批通过项。在线NASA LRO页加载成功，但随后截图超时；未把它报告为视觉成对通过。

日心任务黄道法向、NASA全部定制距离/偏角、完整过渡动作仍需独立对齐，不能称为所有相机功能已一模一样。

实际浏览器另复测地球、木卫一Nearby/System/Follow及木星System，截图保留；木卫一15/15源就绪，浏览器error日志为空。仍未把全部天体、所有NASA操作声明为成对验收通过。

System角度追加修正：jupiter-system-before-angle.png是发现的侧看问题；system-angle-red.log记录缺少25°抬升的断言失败。最终实现保留上一镜头方位并抬升25°，原生fit使用实际基。native.log提取自最终checks.log原生段，不是早期结果沿用。
