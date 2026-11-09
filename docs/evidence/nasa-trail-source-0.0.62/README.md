# 0.0.62 NASA航天器拖尾校正证据

## 可复查来源

本地NASA源码：Entity-567.js读取每目标trail.length/lengthCoverages；TrailComponent.js负责时间窗与自动回退；TrailShader.js按索引渐隐；TrailManager.js航天器白色。原始配置来自platform/eyes-catalog.json，没有改写星历。

真实源核验脚本real-source-cost.mjs，可在项目根目录、3006服务运行时执行。TDB=846724000，普通预算184、选中512，5次Node求值；这不是GPU帧率。五对象历史首点均达到对应配置窗口：ISS5573秒、Chandra228505.5秒、MRO6720秒、Juno5184000秒、Voyager1 946080000秒。配置只定义展示窗口，真实数据缺口仍保留，不等同于科学精度认证。

此前0.0.59记录钱德拉160点只有14284.96秒、256点28569.92秒。本轮184点预算实际163点、完整228505.5秒；Juno选中340点保留60天，未增加总16384点硬上限。

## 本地检查与实际GPU

checks.log为最终完整check-core结果：149平台/验证、16基础WASM、2真实DYN、62网页、52宿主、114原生渲染，加编译、clippy、TS、Release WASM、Next生产构建及资产检查。实际GPU另行观察，不能以编译替代。

生产0.0.62实际浏览器：local-earth.png显示整组白色拖尾；选中Chandra模型正常。480倍播放从846724000前进到846750323.392，随后暂停，见local-earth-playing-then-paused.png。真实源加载状态82/86，其余4项该时刻无覆盖，不伪造位置。最终错误/警告另存browser-logs.json。

独立审查指出精度预算不足不应伪装为缺口：已修复，新增多圈固定预算连续性测试并复审无新明确缺陷。选中精细状态另行缓存，避免普通/选中同点数时不升级。

## 认证边界

official-earth.png/txt来自NASA官方当前实时页面，未成功设置为相同TDB与相机，不作为同条件像素对照认证。NASA逐顶点连续宽度锥形仍未实现，当前固定线宽；本轮对齐配置尾长、阶段、白色与索引渐隐，不宣称全部视觉相同。无长期GPU峰值及全部设备认证。
