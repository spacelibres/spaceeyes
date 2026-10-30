# NASA Eyes观察导航与场景链接设计

第六批延续用户全局授权。以NASA对象路径、分享和浏览器导航语义为参考，补齐刷新/返回/分享时观察对象与统一时间的一致性；同时针对Rumba历史近景异常建立原生复现，不能通过关闭碰撞或伪造模型修复。

场景链接采用同源hash #/对象ID；总览#/home。可选query tdb（明确J2000 TDB秒，绝对值≤1e12）、rate（非零有限且≤94608000）、play(0/1)、mode(nearby/system/follow)、follow、view(orbit/top/front/side)、light(natural/shadow/flood)、fov(10..100)，以及labels/orbits/trails/moons/craft五个0/1图层标志。所有对象ID必须在公开目录，follow不同目标，未知字段/重复/过长参数拒绝；没有hash维持默认LIVE。禁止URL携带任意资源地址或Bevy内部对象。

恢复链接通过现有WorkspaceRuntime受控能力；先暂停、设置目标与依赖、在指定科学时刻统一reload，再恢复相机模式/视场/光照/图层与播放，整个操作有意图世代保护。失败明确反馈，不能显示已恢复。核心仍唯一科学时钟。

对象选择/总览导航pushState保存可回退的语义状态；其它显式操作替换当前项，不逐帧写URL。popstate/hashchange按最后意图恢复，不循环触发自身、不复活已释放runtime。初次带链接只恢复一次。分享面板生成当前snapshot链接，用户点击复制到剪贴板，失败保留可手动选取只读URL。分享的是对象/时间/观察模式等语义状态，不声称保存未提供SDK的精确鼠标轨道姿态。保留spacelibre品牌，不复制NASA品牌。

近景缺陷先以大科学坐标、小模型、变时/焦点、真实包围范围及碰撞的原生App测试定位。若需增加诊断，仅只读科学位置、模型包围及碰撞状态，不暴露Bevy Transform，不放宽非穿透约束。确认根因后最小修复并执行GPU代表场景。

验收parser严格输入/完整往返/未知及重复拒绝；真实WASM恢复单一时刻/暂停倒播/Follow/图层/权限生命周期；浏览器刷新、前后退、复制/失败反馈以及Earth/Moon/ISS/Rumba场景。完整检查、版本、CHANGELOG、提交推送gh依旧。
