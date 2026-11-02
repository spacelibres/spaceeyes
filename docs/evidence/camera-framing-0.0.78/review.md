# 独立审查

按 requesting-code-review 技能发起只读 review_camera78，范围renderer.rs、camera_framing.rs和本批设计。

发现：系统fit_distance沿用旧Ry*Rx，但新相机使用frame*Ry*Rx；倾斜北向、不对称成员会取景错误。新增system-red.log证实旧计算距离350.63km、实际相机基预期176.88km；已统一拟合和实际位姿所用有效frame，固定预设保持identity。

同时排除Follow的自动向阳近景回退，保持独立Follow规则；不可投影的目录半径走既有AABB回退，零缩放量不引入数值漂移。复审确认问题已解决，未发现新的具体回归。审查未运行构建，实际检查以checks.log和浏览器证据为准。

GPU识别到System缺少NASA默认25°参考平面抬升；system-angle-red.log先复现旧0°错误，随后在进入时保留前镜头方位、投影到北向平面并抬升25°。复审确认显示/科学坐标转换和拟合基一致，手动环绕不受逐帧重置。最终checks.log完整通过。
