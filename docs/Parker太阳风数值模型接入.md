# Parker太阳风数值模型接入

用户已确认使用天文学方程及公开数值填充模型。目标是将外流的径向速度、密度和时间从噪声参数升级为可复核数值；不声称完整MHD。

独立TS模块求等温球对称跨声速Parker解：w-ln(w)=4ln(r/rc)+4rc/r-3，w=(u/cs)^2，rc=GM/(2cs²)，cs²=2kT/mp（纯完全电离氢，Te=Tp）。以1AU电子密度边界按r²nu守恒求密度。对数半径网格积分dr/u得到飞行时间。

公开常数：IAU2015 nominal GM=1.3271244e20m³/s²，R=6.957e8m；SI k=1.380649e-23J/K；CODATA2022 mp=1.67262192595e-27kg；AU=149597870700m。来源：https://www.iau.org/static/resolutions/IAU2015_English.pdf ，https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html ，https://pml.nist.gov/cuu/Constants/ 。方程：https://farside.ph.utexas.edu/teaching/plasma/lectures/node109.html 。

示例边界T=1.5MK、1AU ne=5cm^-3为可变场景假设，非特定日期实测；NASA公开密度范围参考 https://science.gsfc.nasa.gov/attic/cosmicopia.gsfc.nasa.gov/qa_sun.html 。纯氢假设忽略氦和双温/非等温，不把光球5772K作为日冕温度。

实施：先数值测试声速点、隐式残差、质量守恒、径向单调、量纲和无效输入；生成外置WGSL查表及JSON审计，资源不进WASM。WGSL以飞行时间输运扰动、密度平方作为等温光学薄发射相对包络；未引入CHIANTI响应，故不是绝对辐射亮度。噪声仍仅为显示扰动，非计算磁场。

显示限制：现有NASA DYN太阳半径695500km与IAU nominal半径695700km分别保留，显示归一化明确使用模型r/R，不改科学对象。可视体积仍有限，不把2.8R壳体当成太阳风边界。科学结果和时间压缩/色调增强分开记录。光球、日珥仍旧视觉模块，本批不宣称移除全部静态表面或完成核聚变/对流模型。
