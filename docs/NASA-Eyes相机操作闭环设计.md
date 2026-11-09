# NASA Eyes 相机操作闭环设计

依据全局对齐路线第二批，用户2026-10-31已授权连续自动实施。前一批b2e18fb26已完成真实卫星拖尾；本批保持单一Bevy相机与统一科学时钟。官方本轮View Options实测Nearby/System/Follow；恢复CameraScripts._goToSystem对目标及非航天器子体取景；CameraFollowManager区分当前观察对象target与跟随对象followId，不能用重复focus冒充follow。

## 行为与边界

Nearby聚焦选中对象表面/模型包围范围；System在选中对象为中心、按所属天然卫星系统取景，航天器可显示但不扩大系统取景范围；Follow相机仍锚定选中对象，朝向指定跟随对象的方向随科学时刻变化，保留有限的偏航/俯仰观察空间。两个对象必须当前有效；缺失暂停该跟随意图并明确反馈，不猜轨迹。全部模式保留碰撞、轻惯性、FOV、局部原点和既有预设视角。

受控SDK新增camera.observe(targetId,mode,options?)，mode为nearby/system/follow，options仅members（最多128个唯一已登记对象ID）和followId；follow要求followId!=targetId，system要求members含targetId。nearby无附加项。默认focus仍等于nearby；overview清理观察模式。

SDK新增camera.orbit(yawRadians,pitchRadians)单次每分量有限[-0.5,0.5]，camera.zoom(delta)有限[-1,1]，负值靠近、正值拉远。累积输入每帧消费，使用核心已有Motion和碰撞链；退出/撤权丢弃待执行意图。它不是直接设置Transform或访问Bevy。

RustCore.set_camera_observation(session,plugin,target,mode,members,followId)，WASM camera_observe(session,plugin,json{targetId,mode,members?,followId?})，camera_observation()返回JSON观察状态。WASM camera_orbit(session,plugin,yaw,pitch)、camera_zoom(session,plugin,delta)。全部camera.control授权、有限范围/已存在对象/当前状态二次验证。

宿主新增observation(mode,followId?)、zoom(delta)、orbit(yaw,pitch)与follow(referenceId?)，snapshot observationMode和followId；选择默认nearby。System按父子目录加载必要对象，Follow加载明确引用及父体依赖，保持时间播放状态。

界面添加Nearby/System/Follow模式、跟随对象选择、缩放±按钮；canvas可聚焦，方向键绕转、+/-缩放、Home近景复位，Space切换播放，输入框操作不被全局快捷键截获。触摸单指绕转、双指捏合缩放，取消/离开清理指针；鼠标仍走既有Bevy路径，防止双倍输入。

系统场景按目录显示主要天然卫星与所属航天器；分组开关独立，代理标记/轨迹按需显示，只有相关高细节对象触发模型。观察卫星/飞船时按需请求其父行星表面，解决ISS拉远地球仍为蓝球；不提前下载整个目录资源。

## 验收

权限/类型/范围/释放/单次消费；三个模式不同取景；系统目标居中、卫星入框；Follow随参考方向转动且不同于普通focus，缺数据无伪跟随；鼠标/键盘/触摸同一碰撞惯性；手机横屏可操作；地球→月球→ISS→系统→总览/播放与资源恢复；全量检查+实际GPU后补丁版本/CHANGELOG/提交推送/gh。

本批不把过渡曲线已实现当作NASA像素级一致；保留成对验证差异。无限远银河与真实恒星位置不随控件改变科学尺度。
