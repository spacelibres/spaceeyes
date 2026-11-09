# SpaceEyes VPS 部署

面向 `www.spaceeyes.cn` 的 Ubuntu x86-64 VPS。Caddy 提供 HTTPS；systemd 分别管理网页、只监听本机的签名接收器和定时缓存维护。安装入口为 `sudo bash deploy/install.sh`，需要事先安全地写入 `/etc/spaceeyes/webhook.secret`，并在 GitHub 仓库设置同值的 `SPACEEYES_DEPLOY_SECRET`。密钥为 32 字节随机数的 64 位小写十六进制，权限 0600；不要提交或输出密钥。

在 `main` 的 CI 检查、独立包路径验证与启动冒烟测试通过后，Actions 将 Linux 构建包用 HMAC-SHA256 绑定提交 SHA 后送至 `https://www.spaceeyes.cn/_spaceeyes/deploy`。接收器限制单包大小、一次一个部署、确认 GitHub 最新 main，并在正式切换前再次核对；新版本监听本机 3101 做健康检查，切换至 3100 后再次检查。失败时回滚；仅保留最近两个成功版本。部署服务脚本本身的变更需要人工重新运行安装入口，业务代码随 webhook 更新。

网页使用 `/opt/spaceeyes/shared/cache`，跨版本共用。`galaxy-lod` 是固定七级银河资产，不参与清理；DYN、NASA 静态源、模型转换和其他可重建缓存按约 6 GiB 软目标清理，默认每分钟运行，最近写入和临时文件不删除。整个文件系统达到约 18 GiB 时进一步收紧目标，部署在此阈值停止以保留约 2 GiB。此方案不是内核文件系统硬配额：单次下载、其他服务、临时文件和定时清理间隔仍可能产生短暂超额，需要监控磁盘与定时任务状态。未命中的可重建资源重新从受控来源获取；上游失败、科学覆盖缺失与来源校验错误仍明确报告。

首次安装前另需准备经校验的银河七级资产到 `/opt/spaceeyes/shared/cache/galaxy-lod`，并核对 `manifest.json` 与各文件散列。不要从本地复制整个 DYN 镜像到 20 GB VPS。常用检查：`systemctl status spaceeyes-web spaceeyes-webhook spaceeyes-cache.timer caddy`、`journalctl -u spaceeyes-web -u spaceeyes-webhook --since today`、`du -sh /opt/spaceeyes/shared/cache/*`、`df -h /`。第三方数据许可仍分别适用。
