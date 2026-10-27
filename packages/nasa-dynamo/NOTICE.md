# 来源与许可说明

本包的项目自有代码采用根目录 MIT 许可证。

## 行为参考

- 仓库：`https://github.com/spacelibres/solarsystem`
- 固定提交：`4a8a83be2ff8298d7fe26fc5c9bbfe47f2fee7db`（0.2.73，2026-10-25）
- 参考文件与固定提交下的 SHA-256：
  - `src/lib/dynamo/parse.ts` — `d0f8df3f2e455b4ae08a11eb6626e22c4a3a17bd49cd0b28cb66c851ceddc759`
  - `src/lib/dynamo/reader.ts` — `e9d4ff33bfd8b6ca37a9253eb30a16efcc34ddb0e2d061a55a7d79bb814b8790`
  - `src/lib/dynamo/math.ts` — `a1293ff3bab36f1342d0faa35fdfdccb5552686a8d6ac674b453eff3a188930c`
  - `src/lib/dynamo/orbit.ts` — `56183773fbba5262bd2601955462eac01f08162700c25370c7108f4647ef7edc`
  - `src/solar/domain/ephemeris.ts` — `f8a0f3985d6747c022400080d2cdef1c72f1c53745ea837d21ac99e0e38e08ae`
- 该仓库 `package.json` 声明 `"license": "MIT"`；仓库根没有 `LICENSE`/`COPYING`/`NOTICE` 文件，此缺失已记录为风险。

## 排除内容

以下内容未复制、未改编、未随本包分发：

- `eyes/` 下恢复的 NASA Eyes 源码；
- `tests/fixtures/*.dyn` 等 NASA 星历数据；
- Starlink 数据（`.dyn`）与模型（`.glb`）；
- 任何 NASA 图像、字体、纹理或商标资产。

本实现的行为、格式事实与合成样本见 `docs/P04参考DYN来源核验与黄金样本规范.md`。与 NASA 无隶属或背书关系；NASA/JPL 数据署名不因本项目 MIT 声明而改变。
