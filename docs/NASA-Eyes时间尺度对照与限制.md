# NASA Eyes时间尺度对照与限制

2026-10-31，对照用户参考仓库eyes/src/engine/core/TimeUtils.js及TimeManager-728.js，Hifitime锁定4.3.1官方本机源码。恢复UI公式是unix−946727957.816+累计表内闰秒，momentToET再取到毫秒；其ET表现为TT型近似。Hifitime TDB包含约1.658ms周期项，不能把两者字段名当同义词。

validation/eyes-time-reference.json包含18个独立恢复UI值及源文件sha256；覆盖J2000、四季与2005/2008/2012/2015/2016闰秒边界，固定阈值在对照运行前确定：恢复ET与Hifitime J2000 TT≤1微秒；恢复UI毫秒值与平台TDB≤2.2毫秒；普通Unix↔TDB往返≤1微秒。core/tests/eyes_time_reference.rs运行这些对照及45个闰秒前后普通Unix样本。

测试复现Hifitime4.3.1内置TDB→Unix在若干闰秒前普通小数秒少1秒。适配层time_conversion使用其正向UTC→TDB残差最多3次修正逆候选，不自行维护闰秒表或改变核心TDB时钟。原1微秒阈值保持，修复后通过。真正23:59:60没有Unix前像，保留库原有fold并验证有限；不宣称Unix在闰秒为双射。

这只证明恢复UI转换的一致性和平台普通UTC投影；尚未独立证明每个DYN文件生成时使用TT还是SPICE TDB，不对DYN时间轴擅自再加周期项，不作为真实轨道位置/速度/姿态精度认证。NASA近似星历来源及不确定性标识保留；Nyx服务器科学任务仍另行规划。
