# NASA Eyes模型取景半径设计

第七批针对已实际定位的问题：Rumba科学位置正确、碰撞未调整，相机按GLB完整±44m细天线包围半径62.26m取景，主体仅十余像素。NASA目录extentsRadius=.00435km为显示取景参数；CameraManager.followTheEntity明确使用getExtentsRadius及5倍偏移。模型真实几何、km缩放、科学位置不能为视觉效果改大。

在现有VisualSpec model新增可选framingRadiusKm（Rust framing_radius_km），有限且0<值≤1e12；TS SDK严格字段/数值，WASM Serde兼容默认None，Rust独立验证。它仅提示自动取景半径，不更改ObjectState.radiusKm、模型scaleKmPerUnit、AABB/科学位置及碰撞固体；不包含任意Bevy结构。未提供仍按完整模型包围取景。

宿主只从已收录且核对的getEyesDefinition(id).extentsRadius取值，存在有效正数时发布显式提示。不用材质或模型bbox猜另一个“科学半径”。取景中心仍依据已有modelbounds；半径计算覆盖hint，System系统范围仍扩展到所属天然卫星、Follow偏移同步使用提示；碰撞球与科学半径不改变。加载前后保持同一目标且不突然弹回旧距离，缩放仍可外拉查看完整细天线。

验收SDK/Rust非法值/未知字段/默认None、精确WASM转发；原生小主体+长天线hint明显缩短camera距离但meshtransform和science/collision相同，未hint仍全bounds。真实GPU Rumba历史时刻主体可观察、ISS模型/土星环/其它天体无回归；集中检查版本CHANGELOG提交推送gh。


代表场景追加：木星System中，天然卫星拖尾应保留，木星日心轨道不应变成贯穿局部系统的长直线。保留既有近景body-radius淡隐，并对kind=orbit增加按真实路径半径的尺度淡隐；focus distance≤路径半径2%时隐藏，≥8%时完整，中间smoothstep。路径尺度从科学km采样包围范围计算，不缩放轨道或伪造圆；kind=trail不套这层，全局无focus总览完整显示。阈值是显示策略，不声称NASA物理常数。测试局部系统/太阳系拉远/拖尾保留与未知退化路径。
