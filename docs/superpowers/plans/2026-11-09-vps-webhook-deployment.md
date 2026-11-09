# VPS Webhook Deployment Implementation Plan

**Goal:** 在用户的 20 GB 规划内，安全部署太空之眼并在 GitHub main 通过检查后自动更新。

**Architecture:** Actions 构建经测试的 Linux standalone 包，带提交标识和 HMAC 向 VPS 发送；独立接收服务校验后原子切换版本。Caddy 提供 HTTPS，systemd 运行网站及接收服务；共享目录缓存按需资源，银河固定数据独立保留。

**Tech Stack:** Next.js、Node.js 24、systemd、Caddy、GitHub Actions、受限磁盘缓存。

## 全局约束

- 不变更现有站点，保留 Caddy、SSH；不在 VPS 编译 Rust；密钥不进入仓库。
- main 通过完整检查才部署；HMAC 覆盖提交标识及完整包，拒绝旧版本与未授权请求。
- 不以删功能、降低画质或缩短轨迹节约资源；缓存可重建项目有预算和空闲空间保护。
- 发布与回滚通过独立版本目录完成，缓存跨版本保留；部署失败保持可用旧版本。
- 每个验证通过的迭代 patch 加一，更新 CHANGELOG，提交并推送 main，跟踪 CI。

## 执行次序

1. 实现和测试独立 webhook 验证、提交校验、包路径安全、串行执行、部署与回滚。
2. 实现和测试有界缓存维护、系统保留空间及固定银河资源保护；记录缓存软/硬限制与无法写入时行为。
3. 构建 Linux standalone 包并在 CI 内运行与资源接口相关的冒烟测试；完整检查成功后再发送部署包。
4. 在 VPS 安装隔离用户、受限服务和 Node 24；准备银河固定资产；备份和验证 Caddy 配置后启用独立域名。
5. 配置 GitHub Actions 密钥及 webhook，执行一次真实 main 部署并验证 HTTPS、缓存、失败恢复与自动更新；记录容量和剩余未验收项。
