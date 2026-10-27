# SPACEEYES Core SDK 使用技能书

版本：0.0.1｜状态：M1最小公开客户端；不代表插件平台或浏览器画布完成

项目自有SDK与文档使用根MIT许可证。依据：唯一proto目录、批准ADR、全局开发路线。生成文件禁止手改；运行`bash tools/generate-ts.sh`后用`--check`验证。锁文件安装：`bash tools/setup-sdk.sh`；完整互通验证：`bash tools/check-sdk.sh`。

宿主负责创建WASM实例及显式会话、时间尺度/历元，认证并授权调用者，然后通过`wasmTransport(engine, principal)`闭包注入身份。插件不自报principal、不持有核心内存或私有Engine接口。此transport不构成完整插件权限沙箱，当前尚无正式插件运行时。

创建`CoreClient(transport, sessionId)`，先`await client.connect(requiredOperations)`，再发送生成类型约束的`command(payload, options)`与`query(payload, options)`。支持列表是实现能力，不是授权或当前状态承诺；缺失能力应停止并报告，不能绕过SDK访问私有核心。Live、画布、动态提供者、事件、项目文件等尚未开放。

每个写请求由调用者提供唯一requestId；重试必须保持同一ID、载荷和前置条件。SDK不自动重试，也不维护第二套场景/时钟状态。修订、代次、秒、纳秒步进等64位字段使用bigint；不要转为number或JSON数字。对象坐标以米、四元数wxyz、时间尺度及历元显式提供；不做科学时间或参考系猜测。子参考系采样仅在该时刻有效。

读取当前会话状态获取修订与代次，然后提交带expectedSceneRevision/timeGeneration的命令；Spatial写入还需expectedRevision。SceneTransaction只负责Scene原子批次，不把多条跨模块命令当成同一事务。资源先登记再引用，受消息/几何/纹理配额约束；失败时通过结构化CoreRemoteError识别冲突、过时代次、覆盖缺失等，不伪造成功。

查询ID可以重复以读取最新状态，查询不消耗命令幂等历史。历史容量/剩余值是发现时的快照，不能视为永久预留。结构化错误保持code/requestId；传输失败、消息过大、响应关联错误和不支持的能力在客户端直接失败，不隐式重试。

Stop终止会话并清理登记资源，不能Start重启；旧写回执是历史结果，不证明当前仍存在资源或Running。宿主应先Stop并处理结果，再在finally中调用WASM实例free；CoreClient不拥有实例，不擅自释放共享宿主。卸载、取消、权限撤销和GPU恢复的完整平台流程仍待后续里程碑。

验收须以真实Native与WASM运行：新会话→能力发现→参考系/资源→相机/场景→时间/查询→错误/幂等→Stop/释放。测试使用合成几何和图片字节，不引入未经许可的NASA资产。Node中的WASM通过不代表浏览器、WebGPU或科学对照通过。
