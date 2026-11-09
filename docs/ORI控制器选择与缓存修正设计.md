# ORI控制器选择与缓存修正设计

用户已批准按全局审查A04及修正顺序实施。依据本地NASA Entity-62.getOrientationAtTime：有效控制器按声明顺序作用，后续Dynamo覆盖前值，后续fixed/align/spin继续作用。不执行源回调，也不让姿态修复改变位置、时间、相机、光照或动画。

服务器按请求epoch筛选声明覆盖，逆序查找最后实际覆盖的ORI；只有已证明的根覆盖外允许继续较早控制器，HTTP/坏包/索引异常立即报告。成功沿用x-dyn-controller-selection携带track与有效域，域和原始DYN覆盖分开。多个ORI均无覆盖时返回明确的absence域（最近过去末端到最近未来起点的开区间），不得伪造姿态或把一个源的覆盖当所有源覆盖。单ORI根覆盖外旧头保持兼容。

数据插件按活动ORI声明key、选中track、有效域与实际样本覆盖共同判缓存；只在选中ORI的声明位置应用该数据，随后执行fixed/align/spin，不能将同一包重复套入其它ORI槽位。已证实absence域内保留先前有效fixed/align，离开该域或声明集合变化必须重新查询；错误不能当absence缓存。新元数据随checkpoint/rollback/retain/dispose一同管理，保持256对象及既有记录预算。

测试先失败后修复：覆盖重叠及闭端点、较晚根覆盖外、HTTP/坏包不回退、多源gap无覆盖、同父体阶段切换、有效域缓存失效、正倒跳、固定姿态覆盖与回滚/释放。真实Mars2020/MSL/InSight阶段及LRO/Psyche回归，完整Rust/TS/WASM/Next/资源/宿主和实际页面。未知坏ORI包仍不自动修复，独立记录；版本与CHANGELOG单独提交，不将本项等同全部控制器动作完成。
