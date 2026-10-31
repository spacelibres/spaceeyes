# NASA轨道加法混合修复

用户要求修复亮银河上的黑轨道，并继续按NASA源码执行。LineShader.js和TrailShader.js均为additive、depthWrite=false；TrailManager规定八大行星RGB和primary=.75、secondary=.35、hover=1。当前Gizmos使用普通ALPHA_BLENDING且写深度，与参考不一致。此前“银河排序反了”的初判经Bevy源码核对否定，不改银河负排序常量。

在现有Bevy Material扩展内增加一批屏幕像素宽线：加法混合、不写深度、保留行星深度测试；同一持久mesh/material复用，预算和科学轨道不变，WGSL外置。完全透明区间不提交，行星使用NASA原始配色，天然卫星/航天器白色，正常/悬停亮度按源规则。已有拖尾索引可同时传入端点宽度，复现0→2、悬停2→4的连续渐细。

先测混合状态、零alpha背景不变、正alpha不压暗背景、遮挡与宽度；复验真实GPU亮/暗银河、八行星总览、近景轨道隐去、悬停、卫星拖尾/行星轨道独立开关、播放及对象切换。完整本地check-core、独立审查、版本/CHANGELOG、提交推送及gh CI。只声明本轮实际验证的NASA功能，不宣称平台所有功能完备。

追加源码核验：Color和LineMesh直接写入原始RGB，移除sRGB二次解码；LineShader glowWidth0没有额外片元透明抗锯齿，改用实际宽度与相机MSAA。金表原值GPU顶点回归先失败后修复。批次上界为既有解析92160段加输入16384段，不增加科学输入预算。
