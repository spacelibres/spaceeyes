# 三任务位置控制器根包修复（网页0.0.75）

范围：只修复Europa Clipper、Juice、Lucy位置源根包，使后续/过去飞掠轨道经证明不覆盖请求时刻时，既有逆序位置控制器选择可继续当前日心源。核心0.0.56、SDK0.0.47不变，不改变画质、帧率、相机、拖尾/自然轨道显示，也不把ORI差异夹带修复。

NASA依据：本地engine/controllers/DynamoController.js的DynamoPointSet.getPoints（约414–439行）按左闭右开区间及二分选择相邻原记录；对非末端时刻，末尾重复时刻不影响选中的有序前缀。平台严格decoder继续拒绝未知非递增记录。18份已审查源逐一固定SHA、字节布局、前缀和原始fixture，见source-review.json；完整位置根目录请求见all-roots.json。

13份末时刻记录内容冲突，不能任意挑一个，精确冲突时刻硬错误且不回退，缓存有效域upperExclusive同步排除。5份末记录逐字节相同，可以保留原前缀闭端点。不改任何样本内容、不全局排序、不把未来轨道错误当作当前无覆盖的通用判断。新源SHA变化走原严格decoder，拒绝未经审查修复。

TDD先证明旧规则无有效窗口，再证明缺少缓存域传播时端点可被缓存错误接纳；最终测试覆盖原字节、有效覆盖、冲突/相同端点、未知SHA和三个完整真实声明链。真实当前位置探针（epoch846686627）已返回三条日心轨，页面与最终完整检查另存证据。所有副作用均通过已有受控数据路径，不开放Bevy或插件权限。

此批不解决Lucy姿态坏索引、ISS姿态403、Juno姿态源异常或ORI多轨选择；这些状态必须保留明确来源和缺项，不用假姿态或成功位置状态掩盖。

## 最终验证

完整check-core.ps1（Renderer/ReleaseWasm/Workspace/NativeCamera/Samples/JunoAssets/SolarAssets）退出0：211平台与验证、17基础WASM、2真实DYN、95网页、65宿主、144原生渲染，含fmt/clippy/TS/Next与资源。

生产服务器真实插件加载epoch846686627：三者均status=ready且位置有限，见live-positions.json。浏览器总览23/23，原三飞船源错误消失；逐个选中后均为数据ready/显示资源ready，见overview-ready.png、clipper-ready.png、juice-ready.png、lucy-ready.png。Lucy仍显式显示姿态不可用、不作真实姿态声明。不能以位置/资源ready冒充姿态正确或全功能验收。browser-logs.json保留本轮浏览器警告/错误。
