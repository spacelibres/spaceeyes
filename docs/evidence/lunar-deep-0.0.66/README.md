# 网页0.0.66 / SDK0.0.40 / 核心0.0.53

基线c76efd085。修改前月球LRO UnknownObject、自动深空历史不足300天均失败，见before.log；独立审查发现近径向自动时长下限问题，radial-before.log记录失败，最终修正并加入零速/极低速。

完整检查checks.log：162平台/验证、16基础WASM、2真实DYN、62网页、55宿主、124原生渲染，Rust/TS/clippy/ReleaseWASM/Next构建/资源检查通过。独立复审未发现新增明确缺陷；没有声称全部NASA功能通过。

## 真实NASA数值

real-dyn.json在TDB846724000从本地服务实际调取NASA DYN，使用本轮SolarSystemData求值，未构造替代星历：

- LRO parent=moon，Ready，7106.66秒历史，129点，0断点。
- ARTEMIS P1/P2 parent=moon，Ready，约90113/96753秒历史。
- Danuri当时真实覆盖外；没有伪造显示状态。
- Psyche parent=sun，自动时长约95022377秒，当前阶段实际过去14421620秒（约167天），47点，0断点；此前默认分支最多30天且会再按预算缩短。
- Voyager1 parent=sun，实际过去946080000秒（30×365天），10点，0断点；缓弯长弧不要求人为凑满512点。

## 实际GPU

生产服务3006重新启动后进行，网页0.0.66。从Moon系统进入，85/90目标可用（五项当时无覆盖，含Danuri），返回Moon、切换视角、缩放及选择LRO与Psyche实际完成。moon-system.png显示月球近景和围月轨迹；lro-model.png显示真实LRO模型和Ready状态；psyche-model.png显示深空飞船实际模型与Ready。browser-logs.json的warn/error为空。

长历史的时间范围由真实DYN JSON证明，近景模型截图不冒充完整长弧同NASA同机位像素认证。LRO及Psyche当前姿态请求不可用，界面明确提示；Psyche太阳翼等待有效姿态，未把模型Ready误当姿态/骨骼已验收。

跨父体历史仍限制当前阶段，没有移除边界后混用不匹配DYN；历史分段缓存和参考系转换待专项。系统相机对Moon航天器的完整取景、所有视角标签阈值、全目录姿态及长期GPU性能未在本轮宣称通过。
