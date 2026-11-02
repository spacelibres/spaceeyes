# 模型阶段与部件显隐验证：网页0.0.72

本批依据已审查Coverage清单实现16个模型URL/变换槽位、10个部件显隐槽位，共11对象、27个不可变变体。固定声明数据保留源动作hash，不执行NASA回调代码。7份新增glTF共800376字节，86份依赖共42236296字节，均固定URL、大小及SHA；资源按需从服务器获取，不写入WASM。

## 实现与边界

所有非激活动作退出先于激活动作进入；闭区间交界按声明顺序取最终状态。从原始模型重算，因此正向、倒向及跳时不会积累隐藏状态。同阶段复用冻结对象，不逐帧重置模型。变体经既有受控visual.set注册及替换，不开放插件访问Bevy节点。

模型绝对四元数使用源WXYZ，转换为XYZW并接入既有负90度X轴坐标基变换；平移保留[x,z,-y]公里换算。隐藏操作移除目标子树的mesh引用，保留节点、变换、关节和其它实例共享mesh。按NASA GLTFLoader净化规则匹配solar_panels.等名字，不改节点原名。缺失名字按NASA语义忽略；某些落地模型已不存在巡航部件，不补造几何。

这是离散阶段模型和部件显示，不代表连续展开动画、完整骨骼、全部姿态或所有NASA功能完成。剩余41个有效Coverage槽位另行实施。

## 集中验证

先验证缺失模块、错误阶段路由、每帧克隆及名字净化缺失的回归失败，再完成实现并重跑。最终完整命令：

```powershell
pwsh -NoProfile -File tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets
```

最终exit 0，198平台验证、16基础WASM、2真实DYN、75网页、62宿主、128原生渲染全部通过，含Rust、TS、clippy、ReleaseWASM、Next及资源检查。日志见[checks.log](checks.log)。阶段端点、倒序恢复、不可变性、共享几何与受控资源路径都有专项回归。

`node web/scripts/verify-model-phases.ts`实际获取并转换全部27个变体，27成功、0错误；结果见[converted-variants.json](converted-variants.json)。Cassini几何数10→9、Rosetta14→9、Stardust14→7，Webb收拢59、展开86；保持节点结构。源文件与依赖审计见[resource-audit.json](resource-audit.json)，HTTP GLB结果见[model-api.json](model-api.json)。

## 实际GPU观察

在最终生产构建的3006服务器、45度FOV和暗面补光下：

- Webb，TDB694937888收拢、694937890展开、反向回到694937888恢复收拢。见[收拢](webb-stowed.png)、[展开](webb-deployed.png)、[恢复](webb-restored.png)。这是实际显示变化，不是只验证编译。
- Cassini，TDB157212063至157212065分离前后均显示真实模型，Huygens部件移除；见[之前](cassini-before.png)、[之后](cassini-after.png)。27变体几何检查和宿主回归进一步覆盖隐藏与恢复语义。
- [browser-logs.json](browser-logs.json)记录本次warn/error为空；[phase-dom.json](phase-dom.json)记录各阶段时间。尚未做与NASA运行实例同时间成对视觉验收，不能宣布完全一致。

观察到的剩余问题：初次Webb历史时刻曾显示History segment budget提示；Cassini视图可见轨迹折线，模型部分被底部控件遮挡。这些不属于已通过的模型阶段结论，不隐藏或报告为修复；后续轨迹/相机构图批次继续处理。Webb粉色材质沿用原资源与当前材质链，也不视作颜色科学验收。

前一提交7552a62b3d1c2d7605e627b9c2f147a5cdbb79f2的CI41268150061经gh核验completed/success。本次提交的远端CI另行跟踪，不沿用旧结果。
