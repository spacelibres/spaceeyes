# NASA Eyes 全局对齐审查与执行路线

日期2026-10-31，审查基线b262cf678。用户本轮明确授权按项目大纲自动审查、实施、集中测试及逐版提交；不再等待每批重复确认。依据太空之眼平台架构书，保持Bevy WASM核心、TS数据插件/Next宿主、外置资源及冻结分支边界。

## 审查证据与范围

三个独立审查覆盖核心相机/轨迹/坐标、平台数据/SDK/资源、网页交互/生命周期/验证入口。它是模块级审查，不声称全部代码逐行穷尽。基础测试通过不等于NASA视觉或科学误差验收。NASA官方入口https://eyes.nasa.gov/apps/solar-system/；既有页面采集见docs/evidence/nasa-eyes-2026-10-28。本轮官方页面初次读取超时，恢复后实测地球Info/View Options，确认Nearby/System/Follow、光照/全屏/缩放/图层/设置及折叠时间栏；System切换后仍保持LIVE与real rate。证据见docs/evidence/nasa-parity-2026-10-31。参考恢复代码来自用户指定solarsystem/eyes，研究机制而非复制引擎。

## 全局差距与实施批次

| 批次 | 当前差距/缺陷 | 可交付结果与验收 |
|---|---|---|
| 1 轨迹、时间及恢复 | 所有对象强制instantaneous；卫星无渐隐尾迹；注释更新失败可部分变更；过期活动请求未取消；总览暂停时间；加载中控件可操作却报错 | 天然/人造卫星和航天器有按TDB过去窗口的真实采样拖尾；行星完整轨道保留；轨道/拖尾独立开关；原子验证、取消；导航不改播放状态；真WASM/真实样本/GPU验证 |
| 2 相机操作闭环 | select/focus/follow重用一条调用，缺少明确模式；缺少缩放按钮、键盘及触摸操作闭环 | 明确聚焦/跟随/系统取景，沿NASA交互语义；受控SDK相机意图、鼠标/键盘/触摸统一执行；碰撞惯性继续有效 |
| 3 时间与浏览界面 | 缺少折叠时间栏、连续时间轴、LIVE与倍率1区分，系统/附近浏览不完整 | 统一科学时钟，暂停/正倒播/跳时/当前时间/倍率1独立；场景级验收地球→月球→播放→总览 |
| 4 模型、姿态与视觉 | 目录接入不等于每项验收；姿态缺失不明确；部件动画、阴影、光照及密集标签仍有未证项 | 地月、火星任务、木星卫星、土星环、ISS/Juno/Voyager代表场景成对对照，缺资源/姿态不伪造 |
| 5 全局预算与科学证据 | 解码缓存缺少独立界限，精度未独立认证，GPU流程未在CI自动执行 | 有界缓存和切换压力测试；NASA参考向量/时间误差记录；固定环境全流程与性能证据。未测项保持未验收 |

不把Nyx/STK、完整市场、大模型自动生成插件混入第一版。NASA故事、比较、望远镜等入口需单独核对与大纲对应，不以仓库存在就任意增项。保持spacelibre品牌。

## 第一批具体设计

采用扩展现有受控轨迹契约的方式，避免另建渲染器/时钟。完整惯性历史与父体相对历史均可表达：无originId表示ICRF绝对坐标；有originId表示在每个采样时刻扣除父体状态、显示时锚定当前父体的相对轨迹，明确不称惯性历史。恢复NASA TrailComponent同样支持relativeToEntity，行星OrbitLine与Trail独立。

SDK trajectory style新增kind:'orbit'|'trail'（默认orbit）、trailDurationSeconds（仅trail，有限1～315576000秒）、breakIndices（严格递增，索引1..N-1，跳过该点之前连接，最多N-1）。沿用originId、colorRgba与严格epoch/所有权/4096总点预算。Rust独立校验。未知字段拒绝。空数组清理不留下旧样式。

核心tail按科学时间窗口[t-duration,t]裁剪、端点时间插值/当前有效位置连接，线段端点透明度从尾0到头1渐变；未来不画、不强制闭合、不跨breakIndices。暂停/倒播/跳时只取科学时刻，不依赖实时时钟积累。现有近景淡隐和浮动原点保留。

数据插件新增trailSamples(id,epoch,count=256,detailed=false)：按真实覆盖/当前任务阶段限定过去窗口，保留少量未来缓存以供播放头连接；不越界外推。不改变现有trajectorySamples('history'/'instantaneous')含义。返回points、epochsTdbSeconds、originId、breakIndices、durationSeconds、refreshRange。天然卫星/航天器选trail，行星仍instantaneous。界面轨道与卫星拖尾分别控制，默认启用，选中轨迹优先分配预算。缺样本显示不可用，不用伪椭圆替代历史。

并行修复set_annotation原子性、活动请求场景取消、加载中播放控件禁用、返回总览保留播放状态。测试先行，再通过完整tools/check-core.ps1集中检查和真实GPU后递增补丁、CHANGELOG、提交推送、gh跟踪。

补充审查发现表面转换缓存可强持有64张8MiB图像并保留CPU副本，潜在载荷约1GiB；首批一并按64MiB缓存界限及上传后释放CPU像素修复，活跃材质引用不强删。

## 2026-10-31迭代核验进度

第一批b2e18fb26、第二批040e487e3、第三批b45bf712a已分别提交推送，详见各版CHANGELOG和GPU证据。第一批远端CI成功，后续状态以gh实时核验为准。

地球场景四个不可用项目Rumba(sc_cluster_ii_fm5)、Samba(sc_cluster_ii_fm7)、Tango(sc_cluster_ii_fm8)、GRIFEX(sc_grifex)通过本地真实DYN接口复核，在TDB846663824.5均返回Outside source coverage。是当前时刻不在源覆盖范围，不是贴图加载失败，也不能靠伪造轨道解决；现有“前往有效观测时间”入口应作为该状态的恢复方式。之后对每个任务按真实覆盖验收。

第四批按NASA光照语义及宿主全屏继续；仍需第五批有界缓存/压力、姿态与逐场景数值/视觉证据。不因前几批通过就勾选全部第一版验收。
