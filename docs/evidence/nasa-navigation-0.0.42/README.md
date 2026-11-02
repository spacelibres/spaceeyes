# 观察导航0.0.42验收

2026-10-31，本地生产127.0.0.1:3006。validation/results/nasa-navigation-0.0.42-checks.log完整通过：109项平台/格式、13项真实WASM、50项web lib、33项宿主集成、84项原生与真实资源、Next构建。取消恢复会回退已完成场景及科学时刻；导航按href去重避免popstate/hashchange双触发。

真实浏览器：历史Rumba链接恢复后选择Earth→Moon；后退恢复Earth、前进恢复Moon，UTC仍2000-08-09T15:00:50.816Z。刷新Moon链接恢复相同时间、暂停、flood模式，restored-moon.png。分享面板生成同源语义链接，点击复制显示成功，share.png。非法初始unknown参数明确报错但10/10总览和LIVE/退出入口继续有效，invalid-link.png。console error/Bevy ERROR为空。

Rumba现场只读诊断：focusedId=sc_cluster_ii_fm5，eye=desired=[111491277.68645537,-94463051.77649927,-40947693.38965585]km，framingRadiusKm=.06226305055618286，collisionAdjusted=false、desiredInside=[]。独立真实DYN求目标=[111491277.68645537,-94463051.52751379,-40947693.38965585]km，相机仅偏移.248985484km（约4倍包围半径），并非卡在远处。模型±44m细长天线使主体被完整AABB取景缩小；目录extentsRadius=.00435km。下一版使用显式取景提示，不改变科学位置或几何缩放。

分享不包含精确鼠标轨道角度。原生900帧三轮fixture检查科学大坐标、小模型、focus与碰撞，但未单凭此宣称NASA全部场景通过。第六批只读诊断未改变碰撞算法。
