# 姿态、模型关节与轨道分类 0.0.47

核心0.0.39、SDK0.0.32、网页0.0.47。完整check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets通过：134项平台、15项真实WASM、2项真实DYN、50项网页库、40项宿主集成、92项原生渲染，加62个表面/环资源及Next生产构建。日志validation/results/model-joints-0.0.47-checks.log。独立复审两项P2先复现失败，再修正并重跑通过。

真实资源核验model-node-audit.json：25条单轴对日控制器、12个实际模型，所有名称按NASA Three规范化规则唯一匹配；源与转换后均0 animation clips/0 skins，运动由刚体节点关节驱动。NOAA20/21模型及8份依赖真实散列补录，原始目录捕获不变，通过派生发现目录接入两对象。

真实GPU ISS：TDB846680000，模型就绪，面板明确“已启用10个对日关节”，未匹配/重名为零。截图iss-joints.png。跳时后按同一规则重新求姿态，暂停不继续积累关节旋转。轴、祖先旋转、嵌套求值与绑定恢复由原生测试核验，不能以一张截图声称姿态角物理精度认证。

天然卫星使用父体相对瞬时完整轨道，人造卫星/航天器使用真实覆盖内过去拖尾。源为非orb记录且覆盖不够全周期时保留真实开放轨迹，禁止虚构闭合。未知任务回调及源覆盖外姿态仍是后续项，不执行未知脚本、也不把缺数据当作正确姿态。

源自旋有relativeToTime时按绝对源时刻求值；无相位时以本次首次有效加载为零点，标为可视化推导，跨独立会话不保证相同绝对相位。关节受机械轴约束时取可转平面最优对日，未增加不存在的转轴。


NOAA20同TDB846680000：真实模型ready、实体align姿态ready、1个关节已应用（noaa20-joint.png），当前地球场景82/86，四项历史任务覆盖外作为信息。ISS跳时TDB846682700仍显示10关节，图像反映机身与翼面变化（iss-seek.png）。console error和Bevy ERROR为空。

地月System、关闭人造飞船后，10/10对象可用，完整父体相对月球轨道可见（moon-orbit.png）；轨道与拖尾分类由宿主集成核验。全流程退出显示工作区已释放。
