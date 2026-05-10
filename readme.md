# Railgun Auto Checkin

使用 GitHub Actions 自动完成 [Railgun][railgun] 每日签到，并支持多账号、定时配置、随机签到时间和多渠道通知。

本项目 fork 自 [integration-intelligent/checkin][upstream]，在原项目基础上调整 Repository secrets 配置，增加随机签到、适配 Server 酱通知，并规范相关文档。

## 功能特性

- 自动签到：默认每天北京时间 `09:00` 签到。
- 多账号：`RAILGUN_COOKIE` 支持多行 Cookie。
- 自定义时间：通过 `CHECKIN_TIME` 配置北京时间签到时间。
- 随机时间：通过 `CHECKIN_RANDOM=true` 在配置时间前后 30 分钟内随机签到。
- 通知渠道：支持 PushPlus、WxPusher、Server 酱、企业微信机器人和 Console 日志。

## 快速开始

1. Fork 本仓库。
1. 登录 [Railgun][railgun]，获取账号 Cookie。
1. 在仓库 `Settings` -> `Secrets and variables` -> `Actions` 中添加 Repository secret `RAILGUN_COOKIE`。
1. 启用 GitHub Actions。

启用后，Actions 会按 5 分钟粒度定时唤醒，由脚本判断是否到达当天签到时间。未配置 `CHECKIN_TIME` 时，默认按北京时间 `09:00` 签到。

GitHub Actions 的 `schedule` 可能延迟触发，因此如果没有在目标时间附近准点运行，项目会在当天第一次晚到的 scheduled run 补签；同一天只会处理一次签到，避免重复通知。

## 配置说明

| Secret | 必填 | 示例 | 说明 |
| --- | --- | --- | --- |
| `RAILGUN_COOKIE` | 是 | `koa:sess=...` | Railgun Cookie。多个账号时每行填写一个 Cookie。 |
| `CHECKIN_TIME` | 否 | `08:30` | 北京时间签到时间，格式为 `HH:mm`。默认 `09:00`。 |
| `CHECKIN_RANDOM` | 否 | `true` | 设为 `true` 后，每天在 `CHECKIN_TIME` 前后 30 分钟内生成一个固定随机时间。 |

建议将 `CHECKIN_TIME` 的分钟配置为 `00/05/10/.../55`，以保持与 GitHub Actions 的 5 分钟调度粒度一致。

## 通知配置

通知配置均为可选，可同时配置多个渠道。

| 渠道 | Secret | 示例 | 说明 |
| --- | --- | --- | --- |
| [PushPlus][pushplus] | `PUSHPLUS_TOKEN` | `xxxxxxxx` | PushPlus 推送 token。 |
| [WxPusher][wxpusher] | `WXPUSHER_TOKEN` | `AT_xxxxxxxx` | WxPusher 应用 token。 |
| [WxPusher][wxpusher] | `WXPUSHER_UIDS` | `UID_xxx,UID_yyy` | 接收用户 UID，支持逗号或换行分隔。 |
| [Server 酱][serverchan] | `SERVERCHAN_SENDKEY` | `SCT...` | Server 酱 sendkey，支持普通和 `sctp...` 格式。 |
| 企业微信机器人 | `QYWEIXIN_KEY` | `xxxxxxxx` | 企业微信机器人 webhook URL 中的 `key` 参数。 |
| Console | `CONSOLE_LOG` | `true` | 设为 `true` 后将通知内容输出到 Actions 日志，适合调试。 |

## 旧配置迁移

- `GLADOS_COOKIE` 改为 `RAILGUN_COOKIE`。
- `NOTIFY=pushplus:{token}` 或 `NOTIFY={token}` 改为 `PUSHPLUS_TOKEN={token}`。
- `NOTIFY=wxpusher:{token}:{uid}` 改为 `WXPUSHER_TOKEN={token}` 和 `WXPUSHER_UIDS={uid}`。
- `NOTIFY=qyweixin:{token}` 改为 `QYWEIXIN_KEY={token}`。
- `NOTIFY=console:log` 改为 `CONSOLE_LOG=true`。

## 本地运行

安装依赖并运行脚本：

```bash
npm ci
npm run main
```

本地调试时可设置环境变量，例如：

```bash
RAILGUN_COOKIE="koa:sess=..." CONSOLE_LOG="true" npm run main
```

---

[pushplus]: https://www.pushplus.plus/
[railgun]: https://railgun.info/
[serverchan]: https://sct.ftqq.com/
[upstream]: https://github.com/integration-intelligent/checkin
[wxpusher]: https://wxpusher.zjiecode.com/
