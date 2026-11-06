# 四季画布 FourJ Canvas 版本说明

当前只保留正式版更新。完整历史变化与安装资产见 [GitHub Releases](https://github.com/deepfry666/fourj-canvas/releases)，历史测试版保留归档，不作为当前更新通道。

## 当前正式版 v0.1.11

- [正式 Release](https://github.com/deepfry666/fourj-canvas/releases/tag/v0.1.11)
- 安装包：`FourJCanvas-0.1.11-x64.exe`
- SHA-256：`39a4d1a164af4f3bc718b18347bdaf9f6ad600895dbbacd4ce06bcd9573de47c`

- 新增硅基流动内置图片模板，支持文生图与参考图改图，无需手写 JSON。
- Qwen 改图支持专用编辑模型，Image-Edit-2509 最多可使用三张参考图，并提供模型选错和数量超限提示。
- 当前只提供正式版更新，旧测试设置自动归入正式通道，保留原有配置和工作区。
- 修复部分图片响应格式和远程下载失败导致的生成结果误报，已生成的远程图片仍可显示。
- 正式提供创作 Skill 的创建、试跑、发布及画布执行流程，源码与安装包统一在当前仓库维护。

发布文件同时提供 `latest.yml`、安装包 `.blockmap` 和 `SHA256SUMS.txt`。版本号、包内资源和更新清单已核对；真实 API 与 Windows 安装后运行状态仍见[待测试事项](docs/content/docs/progress/pending-test.zh-CN.mdx)。

当前公开安装包仅适用于 Windows x64，尚未进行 Windows 代码签名；文件哈希用于校验完整性。
