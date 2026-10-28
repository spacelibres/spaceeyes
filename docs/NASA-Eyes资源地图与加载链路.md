# NASA Eyes 资源地图与加载链路

日期：2026-10-28。参考源码固定提交：`4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db`。本文是分析记录，不是实现设计批准或全部资源可用声明。

## 1. 三种位置分开记

| 位置 | 用途 | 注意 |
|---|---|---|
| 恢复源码与目录 | eyes/src/data、engine、app、ui、framework | 包含目录和资源模板，不等于媒体文件全部存于仓库 |
| NASA上游资源 | assets/static、assets/dynamic、apps/solar-system及已声明外部源 | 地址来自明确配置与拼接规则；逐项记录可访问性 |
| 参考项目本地传输 | /nasa/同源路由、mirror、解码器缓存及本地扩展资源 | 属于参考仓库部署策略，不自动成为太空之眼要求 |

静态根：`https://eyes.nasa.gov/assets/static`；动态根：`https://eyes.nasa.gov/assets/dynamic`。来源为 eyes/shell/index.html:50–53，BaseApp.js:65–66注册变量，Downloader.js:43在下载前替换变量。当前官方线上config.js也已观察到同样的根地址。

参考项目build.mjs启用URL改写，将动态根映射为/nasa/live/dynamic、其他资源映射为/nasa等；浏览器看到本地路由不意味着资源来源已改变。源码根地址、实际请求URL、缓存位置和数据版本应分别记录。

## 2. 启动、对象目录和实体定义

启动链：local-entry → main → SolarSystemApp/BaseApp → SceneInfo/TimeInfo/ViewInfo → 实体注册与视图创建 → 实际资源请求。

| 数据 | 在哪里 | 实际作用 |
|---|---|---|
| EntityCatalog | eyes/src/data/EntityCatalog.json | 名称、分类、检索及展示关系；不是DYN/贴图清单 |
| 实体资源描述 | engine/core/Unidentified695.js、EntityEntry-699.js等注册模块 | 半径、父体时间表、controllers、模型及表面模板 |
| SceneInfo | eyes/src/data/SceneInfo.json | 初始组、动态实体和附加显示选项 |
| TimeInfo | eyes/src/data/TimeInfo.json | 该快照应用时间限制，不代表全部资源都覆盖该范围 |
| ViewInfo | eyes/src/data/ViewInfo.json | 按name/class/components构建视图 |
| StoryCatalog | eyes/src/data/StoryCatalog.json | 故事标题、卡片图与链接；有外部应用链接，不都是本地故事 |
| 描述与事件 | apps/solar-system/descriptions/、events/ | BaseApp配置目录，ContentManager另取对象描述JSON |

时间限制的源值为1949-12-31至2049-12-31。它只是该应用配置，不能变成太空之眼的天文时间范围限制。

关键区别：检索目录找到earth之后，还需查实体描述，才能知道earth/sun/orb、earth/ori以及color/normal等通道。不能只导入EntityCatalog就认为资源链完整。

## 3. DYN地址与父体

实体描述 → Entity-567创建控制器 → 拼接动态根/dynamo/相对目录 → DynamoController加载def.dyn → 根据真实索引请求子段 → 按类型求值。

| 对象 | 位置数据相对动态根 | 姿态相对动态根 | 描述中的父体 |
|---|---|---|---|
| 地球 | dynamo/earth/sun/orb/def.dyn | dynamo/earth/ori/def.dyn | sun |
| 月球 | dynamo/moon/earth/orb/def.dyn | dynamo/moon/ori/def.dyn | earth |
| 木星 | dynamo/jupiter/sun/orb/def.dyn | dynamo/jupiter/ori/def.dyn | sun |
| 土星 | dynamo/saturn/sun/orb/def.dyn | dynamo/saturn/ori/def.dyn | sun |

父体来自parents时间表，不能把URL路径第二段当成所有对象的权威参考系。自定义customUrl可绕过默认根，Starlink附加层就是另一来源。嵌套段名、补零位数、终止边界均需读取文件，不能按连续URL盲扫。

本轮月球/土星位置def的HEAD成功；已有地球/木星位置和地球姿态GET样本及散列。未声称表中全部姿态端点与全部子段均已获取。

## 4. 星体贴图、几何和效果

表面链：实体spheroidLOD.textures → Entity-567加静态根/maps → SpheroidLOD逐面替换FACE → TextureLOD按实际sizes选择SIZE → ResourceManager → TextureLoader → 显示材质。

| 对象/效果 | 静态根下模板或生成方式 | 实际尺寸配置 |
|---|---|---|
| 地球彩色 | maps/earth/color_$SIZE_$FACE.png | 16、512、4096 |
| 地球法线/高光/夜面/云 | maps/earth/normal、specular、night、cloud，各自后接_$SIZE_$FACE.png | 均为16、512、4096 |
| 月球彩色 | maps/moon/color_$SIZE_$FACE.png | 16、512、4096 |
| 火星彩色 | maps/mars/color_$SIZE_$FACE.png | 4、512、4096 |
| 木星彩色 | maps/jupiter/color_$SIZE_$FACE.jpg | 16、512、4096 |
| 土星彩色 | maps/saturn/color_$SIZE_$FACE.png | 4、512 |
| 土星环 | sprites/saturn_rings_top.png、saturn_rings_bottom.png | 上下两面纹理，另有遮影逻辑 |
| 星体表面几何 | Spheroid/SpheroidLOD按半径与映射构建 | 不能把贴图面文件当网格文件 |
| 大气 | 相应实体添加程序组件 | 未找到应单列的通用大气贴图地址，不能凭效果猜路径 |

地球云在该定义中是decal纹理通道；不能据其名字就宣称真实体积云。六面/尺寸模板不意味着每一组合在远端存在，应以对象实际定义和请求选择为准。

此次曾按组件默认SIZE=4探测地球与木星，均403；继续核对实体描述后，SIZE=16对应地址均200。这说明默认值不等于对象实际参数，也不能把单个403解释成整类资源不可获取。保留全部探测记录，未删除失败证据。

## 5. 高分辨率影像不是同一种资源

- 静态多面LOD贴图是上一节的maps模板。
- WMTS提供独立的能力文档、图层、矩阵、时间维度与瓦片请求。地球图层有SNPP和NOAA回退入口，Moon/Mars有Trek来源。
- 地球可见地球数据清单为动态根/earth/data/visibleEarth/dataset_manifest.json；清单不是全部影像本身。
- Mapping.js的CMTS路径为动态根/cmts/对象/color、normal、height等，另有floatingClouds逻辑；必须继续读元数据与块布局，不能套WMTS请求规则。
- WMTS失败存在切换HD或标准图的提示；最终截图不证明高分瓦片路径已成功命中。

参考本地应用还会安装snapshot-policy：把特定now/yesterday影像日期固定到2026-10-23，并修改地球图层标题；它不等于仿真时钟固定，也不在此处完成下载缓存。快照JSON的layerId并未由该policy直接用于强制选择图层。太空之眼不自动沿用这个日期或策略。

## 6. 模型、压缩与加载器

模型链：实体model描述 → ModelComponent → glTF文本或GLB二进制 → 外部buffer/贴图依赖 → GLTFLoader及按需几何/纹理解码 → 渲染组件。

| 格式/模块 | 作用 | 已确认与未确认 |
|---|---|---|
| glTF/GLB | 航天器及非球形对象模型 | ModelComponent支持入口，完整模型依赖仍需逐对象展开 |
| Draco | 模型几何压缩 | ModelComponent挂接DRACOLoader，不是DYN解析器 |
| KTX2/Basis | 压缩纹理容器与转码 | TextureLoader挂接KTX2Loader并检测渲染器能力，不能照搬Three探测到Bevy |
| ZSTD | 特定压缩内容解码 | KTX2Loader源码有ZSTD超压缩分支并引用ZSTDDecoder；仅源码核验，未执行转码 |
| decoders/manifest.json | JS/WASM解码依赖URL、大小与散列 | 不是完整NASA资产清单，也不是模型本身 |

稀疏检出起初未取vendor目录；已通过git树确认GLTFLoader、DRACOLoader、KTX2Loader、ZSTDDecoder实际存在，并读取KTX2Loader的Basis/WASM与ZSTD分支。不能把本地未检出误报为仓库缺失。

Bevy是否可直接加载所选资源的压缩扩展，须按锁定版本、features及实际样本测试。本文不根据有JS解码器就声明Rust加载已可用。优先查现成库支持，不先自研通用压缩器。

## 7. 星场、星座和界面资源

| 资源 | 路径或来源 | 解码/显示方式 |
|---|---|---|
| 星系点集 | 静态根/stars/galaxies.0.bin | 二进制Reader与StarfieldComponent，不是天空图片 |
| 恒星点集 | 静态根/stars/stars.索引.bin，实体定义有六份 | 二进制字段与粒子shader，字段完整语义尚需继续核对 |
| 星座 | 静态根/stars/constellations.bin | Reader读name/color/stars/segments，创建线与DOM标签 |
| 标签 | 实体label及运行时对象/星座名称 | 文本/DOM和布局逻辑，不需要假设一个标签图集文件 |
| 故事卡片 | StoryCatalog中NASA assets/images/cards等URL | 按目录链接加载，不混为模型贴图 |
| 描述 | ContentManager按对象ID请求description目录JSON | 其引用图片仍可能带外部依赖 |
| 字体与图标 | shell CSS中的Metropolis/Inter字体、svg/png；引擎还配置Raleway | 页面字体与引擎字体不是同一个配置，平台品牌需独立使用VI |

首页故事面板另被本地home-panel-policy隐藏，不能拿参考本地页面直接推导官方首页默认状态。

## 8. 本轮HTTP探测

完整记录：[resource-head-checks.json](evidence/nasa-eyes-2026-10-28/resource-head-checks.json)。共10次HEAD，8次200，2次403。没有遍历或批量镜像资源，也没有将HEAD成功当作正文完整性或浏览器显示成功。

| 请求 | 状态 | Content-Length |
|---|---|---|
| 月球位置def.dyn | 200 | 3116 |
| 土星位置def.dyn | 200 | 4708 |
| 地球color_16_0.png | 200 | 699 |
| 木星color_16_0.jpg | 200 | 675 |
| 土星环top.png | 200 | 3588 |
| galaxies.0.bin | 200 | 27857 |
| constellations.bin | 200 | 10952 |
| 地球dataset_manifest.json | 200 | 539031 |
| 地球/木星color_4_0 | 各403 | 属于未按实体尺寸配置展开的探测，不作为所需资源失效结论 |

成功响应观察到Access-Control-Allow-Origin:*和must-revalidate,max-age=3600。它们不是再分发授权，也不证明数据每小时变更。未来仍需真实浏览器加载及完整依赖验证。

## 9. 机制闭环与当前缺口

已定位对象与地址的主干，下一步继续补齐以下分析，而不是立即编码：

1. 按代表对象展开完整依赖：位置/姿态、所有表面通道、面/尺寸、模型的buffer与图片、图层清单及回退。
2. 核对WMTS/CMTS请求参数、时间维度、层级与缺块行为；区分动态影像日期和显示时间。
3. 明确星场二进制字段、坐标约定、光度输入与显示映射；确认资源加载时机及释放。
4. 将近景、系统视图和跟随所需的对象依赖与数据覆盖关联起来，避免只看一个天体的文件。
5. 将来源、URL模板、有效参数、更新/缓存、权限、解码器、消费者、验证等级整理成逐对象记录。

资源地图和机制说明清楚后，再确定最小详细设计与实现次序。DYN、贴图、相机、时间都服务完整浏览体验，不成为孤立研究主线。Nyx保持后续服务器计算模块。

## 源码定位索引

所有路径相对固定提交，行号只适用于该快照。

| 证据 | 路径与行号 |
|---|---|
| 根地址与替换 | eyes/shell/index.html:50；eyes/src/engine/core/BaseApp.js:65；eyes/src/engine/core/Downloader.js:43 |
| 目录进入内容管理 | eyes/src/engine/core/BaseApp.js:7、42、151；描述目录:154 |
| 实体实例化与资源转交 | eyes/src/engine/core/Entity-567.js:5、23、57、75、149 |
| 地球/火星/木星/土星定义 | eyes/src/engine/core/Unidentified695.js:213、229、291、320、336、387、404、420 |
| 月球定义 | eyes/src/engine/core/EntityEntry-699.js:5、22、29 |
| 分面和尺寸 | eyes/src/engine/components/SpheroidLODComponent.js:33、50、60；eyes/src/engine/core/TextureLOD.js:111 |
| DYN文件获取 | eyes/src/engine/controllers/DynamoController.js:323、350、703 |
| 影像目录与映射 | eyes/src/engine/core/Unidentified752.js:5；eyes/src/engine/core/Mapping.js:39 |
| 本地快照与首页改写 | eyes/src/runtime/local-entry.js:1；snapshot-policy.js:4；home-panel-policy.js:3 |
| 模型与纹理 | eyes/src/engine/components/ModelComponent.js:180；eyes/src/engine/core/TextureLoader.js:54 |
| 星场与星座 | eyes/src/engine/core/Unidentified695.js:118；eyes/src/engine/managers/SceneManager.js:328；eyes/src/engine/components/ConstellationsComponent.js:84 |
| 构建与本地资源 | eyes/scripts/local-assets.mjs:4；eyes/scripts/build.mjs:41；src/app/nasa/[...path]/route.ts:44 |

参考仓库：https://github.com/spacelibres/solarsystem/tree/4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db/eyes 。恢复源码与媒体资源的许可仍分别核对，本文没有复制上游程序或媒体库。

## 第二轮：模型、动态瓦片与星场实样本

本轮从已定位的源码地址获取元数据，保存原始文件于本机临时目录，不分发第三方资源正文。结构化证据：[resource-dependency-checks.json](evidence/nasa-eyes-2026-10-28/resource-dependency-checks.json)。

### Juno模型的完整外部依赖

实际GET `https://eyes.nasa.gov/assets/static/models/sc_juno/Juno.gltf`：HTTP 200，56278字节，SHA-256 `f409aad5c1e59876eb0ca0a19b6c922b8fcca40fb24eb61b7c0a3e404eaf2de9`。

解析实际JSON确认glTF 2.0、必需扩展KHR_texture_transform；该模型声明没有要求Draco，不能因为系统支持Draco就认为此模型使用Draco。

| 外部依赖 | 类别 | HEAD结果 |
|---|---|---|
| juno_closed.bin | 几何/属性buffer，声明1779752字节 | 200，长度与声明一致 |
| foil_normal.png、foil_dish_normal.png、juno_tex_01_normal.png、juno_array_normal.png | 法线图片入口 | 均200 |
| juno_transparent_crosses.png | 图片入口；最终混合模式须读材质而非按文件名决定 | 200 |
| juno_tex_01_albedo.jpg、juno_array_albedo.jpg | 表面颜色入口 | 均200 |
| juno_tex_01_pbr.jpg、juno_array_pbr.jpg | PBR相关图片入口；通道含义须按材质引用解释 | 均200 |

所有相对URI均按Juno.gltf的所在目录解析，记录中保留绝对URL、类型和响应长度。本次只取模型描述，buffer/图片为HEAD检查，未解码网格、纹理或完整动画层级。不能将“11个文件入口齐全”写成模型已成功显示。

原应用ModelComponent:180–206将相对URI交给GLTFLoader，并允许reference map改写。实体Unidentified712.js:13还记录Juno按时间切换父体与轨迹段，:19声明模型入口、:20起有旋转配置。因此模型资源本身、整体空间姿态、活动父体和部件动画必须分开研究。

### 地球CMTS配置与资源层级

实际GET动态根/cmts/earth/color/configuration.json：HTTP 200，1541字节。配置字段为first_level=-7、tile_size=2048、extension=ktx2，并有28个boundaries条目，其中last_level出现4与12。

这些是当前快照的实际值，不是所有对象通用值。负层级用于该实现的低分辨率层次，不能擅自裁成从0开始；boundaries决定更细区域覆盖，不能按完整均匀金字塔估算或盲下所有块。

源码CMTSComponent:221先加载configuration.json；:503构造低层纹理URL，:551与:678构造面/层级/列/行路径。这里的路径顺序是`${base}/${face}/${level}/${column}/${row}.${extension}`，不能混成WMTS的matrix/row/column。

尚需核对：_getNonPositiveLevel的取层规则、boundaries的精确包含关系、height数据格式/单位、邻接面接缝、缺块回退及KTX2样本实解码。本轮没有根据元数据盲探瓦片。

### 地球WMTS清单到实际瓦片

GET原应用SNPP能力文档成功，实际ResourceURL指向gitc.earthdata.nasa.gov，声明JPEG、250m矩阵集；XML中的Time默认值为2021-06-15，不能当成当前最新影像日期。

GET动态dataset_manifest.json后，availableDates有3948个条目，最大日期为2026-10-26，对应VIIRS_NOAA20_CorrectedReflectance_TrueColor。清单不含2026-10-27。本地客户端日期为2026-10-28，不能保证“昨天”总在清单中。

随后读取已由源定义声明的NOAA-20能力入口，匹配同一layerId，以日期2026-10-26、matrixSet=250m、matrix=0、row=0、col=0展开ResourceURL：

`https://gitc.earthdata.nasa.gov/wmts/epsg4326/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/2026-10-26/250m/0/0/0.jpeg`

HEAD返回200、image/jpeg、52011字节。证明“清单→匹配图层→能力模板→一张瓦片地址”当前可访问，不证明所有层级、整日影像和浏览器拼接显示已通过。

源码WMTSManager:18–24按运行设备日历计算now/yesterday，:67查询指定日期、:71–80选择fallback；如果日期条目不存在，不能把fallback当成任意日期自动回退。未来平台应明确可用日期选择及缺失提示，而不是在后台悄悄更换时间。这个建议尚不是已经确认的接口。

影像日期、DYN显示历元、网页播放时间与未来服务器计算时间分别具有含义，不能因视觉需要强行绑定。参考仓库固定影像快照也不改变这一原则。

### 星系点集的二进制结构

实际GET静态根/stars/galaxies.0.bin：HTTP 200，27857字节，SHA-256 `2fbe14f798539bed8cb0b7770d9ad4fae4b6a460c675b00622a932a967029b05`。

依据StarfieldComponent:94–108及Reader的小端规则，文件开头i32给出1211条记录；每条为两个f32、三个u8、三个f32，共23字节。严格长度检验：4+1211×23=27857，完全吻合。

源码将两个浮点数读入mag、absMag，RGB除255后按最大通道归一化；三个原始坐标重排并对一个分量取反，再旋转到显示所用方向。不能把原始三个数直接赋给Bevy坐标，也不能仅从数量级断言它们的科学单位。

本轮只验证结构长度和源码字段映射，尚未验证所有字段取值、单位、原始星表来源、科学坐标精度、亮度映射正确性和全部六份恒星文件。银河/恒星点集与星座线文件也不是同一种二进制布局。

### 本轮证据等级与剩余任务

已实测：四份初始元数据/二进制GET；Juno十个依赖HEAD；动态日期清单GET；NOAA-20能力文档GET；一个匹配日期WMTS瓦片HEAD；星系点集记录长度核验。

未完成：Bevy解码/显示、模型buffer真实几何及材质通道核对、CMTS完整层级与高度语义、WMTS跨层瓦片拼接/日期刷新/失败回退、星表坐标单位与外部来源、所有资源分发许可。仍继续资源分析，不据本轮进入业务编码。

## 第三轮：材质、地形高度和坐标语义

结构化证据：[resource-semantics-checks.json](evidence/nasa-eyes-2026-10-28/resource-semantics-checks.json)。以下区分实际文件内容、源码如何使用和仍缺的科学依据。

### 模型图片必须按材质引用解释

Juno实际模型含16个材质、27个texture对象、9张唯一图片、14个节点，animations数组不存在（本样本0个glTF动画）。多个texture对象共享相同image，因此不能按texture对象个数重复下载图片，也不能认为材质只能有九个。

已追踪 material → texture.index → texture.source → image.uri：
- juno_tex_01_albedo.jpg、juno_array_albedo.jpg经baseColorTexture引用。
- juno_tex_01_pbr.jpg、juno_array_pbr.jpg经metallicRoughnessTexture引用，不把文件名中的pbr当成任意自定义通道布局。
- normal类图片经normalTexture引用，部分法线强度为0.6或0.5，不能全部按默认1处理。
- crosses.001明确alphaMode=BLEND，图片是juno_transparent_crosses.png。透明策略由材质字段证实，不由文件名猜测。
- black_krinkle.005的normalTexture包含KHR_texture_transform，offset=[0,-1]、scale约[100,2]。只支持颜色纹理变换、忽略法线UV变换会改变外观。

依据[glTF标准](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)，baseColor纹理RGB按sRGB解释，metallicRoughness中G为roughness、B为metallic，数据纹理不能统一按彩色纹理处理。本样本没有occlusionTexture引用，不能仅因PBR图片存在就把R通道接为AO。扩展适用于textureInfo，见[KHR_texture_transform](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_texture_transform/README.md)。

模型node名engine_cover真实存在。恢复实体定义Unidentified712.js:65–78按时间区间修改该节点rotation.x，即使glTF没有动画，应用仍可能有部件运动。还需核对整船姿态DYN、模型内节点变换、实体额外旋转三者的组合，不能用“模型无动画”推断飞行器完全静态。

### CMTS负层级、边框和容器

源码CMTSComponent:916–939按相机投影距离、tile_size与细分阈值计算低层级，并限制到first_level至0。它不是为每次请求任意选一个负数。

实际GET地球color/0/-7/0/0.ktx2成功：728字节，SHA-256 `bee4dcfc2635d96bfb8266cf673ed1bba354b0189385cb97a51ecee681242c1e`。容器标识匹配KTX2，头部pixelWidth=20、pixelHeight=20、faceCount=1、levelCount=5、supercompressionScheme=1、vkFormat=0；五条mip数据索引的区间均未超过文件长度。

按[KTX2规范](https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html)，scheme=1为BasisLZ，不是Zstandard。这只确认容器路径与元数据，未执行ETC1S/Basis转码，也未验证全部mip内容。

源码:907–909的UV换算用tile_size右移负level得到内容尺寸，再加4像素边框。当前配置2048>>7=16，16+4=20，与实际容器尺寸吻合。边框参与采样与相邻瓦片过渡，不能裁掉后仍使用原UV。

源码:1015起按face、level和边界范围决定覆盖；缺块区域不能靠假设全覆盖金字塔补齐。跨面映射和多级父纹理暂用仍须独立核验。

### CMTS高度是数值数据，不是彩色外观

实际GET地球height/configuration.json：200、667字节，SHA-256 `af1dff1275bc718fdb55f16414f56d3affb349bc8795873d6e185f6e447979be`。字段first_level=-3、tile_size=128、extension=webp、height_range={min:-12,max:10}、semi_major_axis=6378.137、semi_minor_axis=6356.752，另有9个边界条目。

源码:1075–1078将RGB三个字节组合成归一化数：R/256 + G/65536 + B/16777216；:699–700结合height_range和组件scale/offset，:1030–1034沿表面法线位移。因此：
- 不能把高度图片当普通亮度图，也不能把三个通道均值当高度。
- 不能先做sRGB颜色转换或任意有损处理，再把变化后的像素解释为高度；实际WebP编码方式尚须获取样本检查。
- 在组件默认scale=1、offset=0时，源码公式对应 -12+22×归一化值。组件覆盖值会改变结果，不能把此式强加给所有对象。
- 椭球半轴数值与地球千米尺度相符，但此元数据没有显式单位字段；仍应追踪整个场景单位及独立地形参考，不凭数值相似宣称已完成精度验证。

目前没有下载并解码高度像素，没有核对实际高度采样误差或垂直基准。WebP格式入口可访问与科学高度可用是两个检查。

### 星场坐标的已知和未知

星场Reader读取坐标后执行分量重排、一个轴取反和黄道/赤道方向旋转。shader注释将通量写成watts per km²，说明显示公式以千米距离解释；这是源码的单位约定证据，不是原始星表来源或距离精度的独立证明。

因此当前可以说明“应用如何使用该坐标”，还不能完整说明“星表原始测量、星等与距离如何生成”。不根据数值很大就断定parsec，也不把显示亮度中对数与clamp映射当成严格科学光度模型。

仍需追溯星表生成来源、坐标单位与方向的外部对照；六份恒星文件及星座语义也须分别覆盖。

### 全局影响和下一轮分析入口

资源并非“找到URL就结束”：对象运动需要父参考系和DYN；航天器需要模型、依赖图片、材质扩展和部件控制；星体近景需要纹理LOD或影像瓦片、边框与高度；最终还受相机、时间与图层状态影响。

| 尚未闭合的环节 | 下一轮所需证据 |
|---|---|
| 模型空间比例与部件 | 实体旋转/缩放、glTF节点变换、DYN姿态合成，模型buffer长度与几何范围 |
| CMTS高度采样 | 一块真实高度WebP、无颜色转换像素解码、范围与插值公式对照 |
| CMTS接缝与回退 | 跨面UV规则、父纹理暂用、缺块与取消的状态轨迹 |
| WMTS表现 | 矩阵原点、像素尺寸、日期缺失、图层回退与真实瓦片显示 |
| 星场科学语义 | 原始星表来源、距离单位和外部参考，不能只读shader命名 |

上述继续作为分析任务，不意味着转入编码或新建自研渲染/解码引擎。成熟库能力仍优先复用。

## 第四轮：真实载荷、模型变换及瓦片连续性

证据：[resource-payload-checks.json](evidence/nasa-eyes-2026-10-28/resource-payload-checks.json)。本轮使用临时分析程序读取样本，不向应用添加解码器或业务实现。

### Juno真实几何与比例

实际下载juno_closed.bin，1779752字节，SHA-256 `ecb0f34d8cdcd961e0e4e6ddf1aafc402be4d2a9071a41ec4829b1a667cebee0`。与glTF buffer.byteLength一致；110个bufferView均落在实际文件内。

对被mesh POSITION引用的22个f32/VEC3 accessor逐点读取，共34637条位置记录：均为有限值，实际min/max与glTF声明在1e-4数值容差内一致；各访问区间均位于所引用bufferView中。这里没有验证索引、全部属性、拓扑或最终世界包围盒，不能据此声称完整模型正确。

ModelComponent.js:18默认缩放为0.001；Entity-567.js:77–96可叠加实体定义中的旋转、比例与平移。ThreeJsHelper.js:98–115先取相机相对位置，再按实体姿态旋转局部offset；:157–165将实体姿态与模型旋转offset相乘。其后仍保留glTF节点自己的层级变换和部件控制。

因此应分别记录：模型局部单位/层级 → 模型比例和轴向修正 → 实体姿态与位置 → 相机相对显示。默认0.001与glTF米制、场景千米制一致，但个别实体可覆盖；不对所有导入资源重复乘0.001，也不通过展现包围半径反推原始几何单位。

### 真实高度像素核验

GET `https://eyes.nasa.gov/assets/dynamic/cmts/earth/height/0/-3/0/0.webp` 成功：562字节，SHA-256 `82eaa20245d7b29d171d51231eda360ca13d00a8c7df83e82c2ca60eca41e97b`。

容器为RIFF/WEBP，图像块为VP8L（无损），Pillow解码得到20×20 RGB，没有检测到ICC profile。与height配置128>>3=16像素内容、再加4边框吻合。

按源码RGB组合公式，样本归一化值范围为0.5440462828至0.6520857811；采用该组件默认scale=1、offset=0及[-12,10]高度范围，数值为约-0.0309817791至2.3458871841。只验证当前低LOD样本与公式，不代表全球高程范围或地形精度。

恢复ResourceManager.js:176–193通过纹理image→Canvas drawImage→getImageData取得高度像素。无损编码不自动证明浏览器Canvas与Pillow得到完全相同的字节；仍需核对颜色管理、图片解码及像素对照，避免把显示路径的颜色处理套进数值路径。

### 瓦片边界和替换不是单一UV公式

源码CMTSComponent.js：
- :1081–1186把越界UV映射到相邻cube face，进行面间旋转/翻转，再归一化并投影椭球；:858–868的法线邻域也使用该映射。
- :907–909将每侧2像素边框纳入UV采样；:598–606对祖先插值形成的临时网格边缘另作处理。这些机制共同处理边界，不单凭边框就保证所有贴图无缝。
- :525–554寻找已加载祖先，计算子区UV并临时引用祖先纹理，避免子块加载时空白。
- :772–796在正式网格就绪后移除临时对象并释放高度数据；:689–691、:964–968在异步完成时复查destroyed并释放迟到资源。
- :428–439包含分裂/合并距离滞回，避免在同一阈值附近反复切LOD。树级原子替换和所有失败路径尚未运行验证。

静态待验证风险：部分allSettled结果未区分rejected；有临时对象时正式_createObject未直接等待或捕获；低层纹理计数主要在成功路径递减。可能造成长期占位或失败状态滞留，但本轮未故障注入，不把这些写成已复现缺陷。后续应记录failed/canceled/retry与保留祖先的实际状态路径。

### 星座真实数据结构已闭合，来源仍未闭合

实际GET constellations.bin：10952字节。按照长度前缀名称、RGBA字节、点数、f32坐标和线段索引读取，完整消耗文件：88个星座、694条点记录、673条线段。所有坐标有限，线段索引均在各自点集范围内。

这证明星座布局与索引结构，不代表坐标单位、原始星表来源或与真实天球投影的方向精度已验证。查阅当前星场相关源码、独立sky模块和分析工具，尚未找到足以确认Hipparcos/Tycho/Gaia等具体生成来源的证据；此结论仅限本轮检查范围，不是声称整个仓库不存在来源记录。

### 仍未满足的全局分析项

1. 模型索引与属性完整性、节点世界变换及最终姿态对照，所有材质和贴图在目标引擎中的支持。
2. 图像数值路径的跨解码器字节一致性、高度单位/垂直基准与外部参考。
3. 跨面接缝、LOD滞回、缺块回退和取消时的实际画面/状态证据。
4. WMTS矩阵坐标、日期选择、影像层来源与动态刷新生命周期。
5. 星场/星座原始目录、科学单位和独立天文坐标对照。

资料已能解释多条加载链，但还不能把所有资源机制标成完成；继续补证据，再判断是否具备编码条件。
