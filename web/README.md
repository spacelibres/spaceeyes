# 太空之眼网页工作区

设计：Next.js仅承载工作区；宿主拥有WasmCore，通过PluginHost批准的SDK操作合成验证对象、时间、视觉与相机。Bevy拥有场景。明确点击启动，防止React StrictMode挂载触发双重run；退出先关闭插件再停止和释放核心。一次页面只启动一次渲染，停止后刷新重新进入。

实际限制：对象位置与时间是合成夹具，不是真实Juno轨道。NASA Juno模型仅用于资源接线验证，完整DYN、姿态、轨迹及NASA Eyes基线尚未实现。TDB秒以J2000起算，不进行虚假UTC换算。资源ready不等于GPU验收。

先运行集中核心构建及tools/prepare-juno.ps1，再运行npm --prefix web run prepare:assets；仅复制固定WASM入口和校验散列的11文件Juno包。生成资源及node_modules不提交。npm --prefix web run dev启动；test、typecheck、build分别验证交互控制逻辑、类型和生产构建。浏览器GPU和响应式视觉须另行实测。

真实DYN检查：/api/dyn/earth-orb与earth-ori仅转发manifest固定端点，服务端no-store/拒绝重定向/16MiB预算/长度及SHA256固定校验，支持取消；样本变化明确失败，构建不请求网络、不保存raw。客户端独立ResourceClient与AbortController解码并显示type/count/source和原始ET覆盖。参考系、科学求值未验收，绝不向Rust发布这些未求值记录。

DYN服务端使用15秒总deadline，与请求AbortSignal合并；获取及流读取全过程响应取消，超时丢弃已接收字节并明确报错。
