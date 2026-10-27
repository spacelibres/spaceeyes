# SPACEEYES 浏览器宿主

版本：0.0.1｜状态：M2-1技术原型｜项目自有内容MIT

依赖Node >=22、Rust wasm32目标、与Cargo.lock匹配的wasm-bindgen及WebGPU浏览器。根目录先运行`bash tools/setup-sdk.sh`和`bash tools/setup-web.sh`，再运行`bash tools/build-web.sh`构建；完整浏览器验收使用`bash tools/check-web.sh`，已经纳入`tools/check.sh --gpu`。启动宿主使用`npm run start --workspace @spaceeyes/web`，关闭后需重新启动进程；环境快照不保留运行中的服务器。

浏览器经同一SDK/Proto创建合成球体、网格、纹理和相机。只有受信宿主接触canvas绑定与独立HostFrame路由；帧入口不属于插件命令，不消耗幂等历史。异步初始化复用同一个模块加载Promise，各挂载仍创建独立Engine/canvas。RAF输入、UI命令与GPU完成串行，卸载等待退出后Stop/free；页面目前不是完整插件权限沙箱。

最大物理画布2048×2048，单帧经过时间限250ms，暂停由唯一Rust时钟处理。Resources为Surface保守预留48MiB附件容量，另计在途顶点/上传/纹理预算；这不是实际VRAM测量。临时预算在GPU完成后回收，卸载/错误清理会话资源；GPU丢失显式停止，自动恢复尚未实现。合成场景不使用NASA素材/科学星历，TT标签不代表已验证科学时间转换。

测试使用真实Chromium及软件WebGPU：测试参数使Dawn/ANGLE/Vulkan都使用SwiftShader，避免软件驱动路径不一致；这些参数只在自动测试配置中，产品不会修改浏览器启动参数。SPACEEYES_BROWSER_PATH可指定测试浏览器；默认采用系统Chromium，缺少时由Playwright锁定版本安装。浏览器像素/相机/时钟/resize/挂载与错误测试和生产构建必须通过，不能用编译或呈现回执代替可见像素证据。

M2后续仍需拾取UI、相机聚焦/跟随、完整时间轴与恢复；M3资源/项目、M4科学数据、后续市场/AI仍按全局路线推进。
