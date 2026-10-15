# dsh-reply-forge-v2

DSH 桌面端插件 v2：**真伪造**——改写的 AI 回复进入会话落盘记录，被大模型
当作真实历史采信，且会话可继续对话。

与 v1（`dsh-reply-forge`，只做本机渲染层伪造）**完全独立**：独立仓库、
独立插件 id、独立安装链路。v1 封版不再演进；v2 不是 v1 的功能升级，
是另一条技术路线。

## 三大目标（验收标准）

1. **dsh 桌面端加载不会崩溃**——bundle 契约、注册 id、patch 插入全部
   合规；与 v1 可分别启用、互不踩踏；
2. **伪造回复会被大模型认同**——改写内容进入会话上下文，下一轮请求
   模型读到的就是伪造历史（含签名降级通道处理）；
3. **还能继续对话**——改写后会话完整性不破坏：可正常打开、可继续
   流式输出、投影/状态机不错位，且可回滚。

## 当前状态（2026-10-15）

**v2.0 已实现并完成读取侧验收；v2.1 / v2.2 未开工。** 设计与实证见 [PLAN.md](PLAN.md)。

| 阶段 | 内容 | 状态 |
|---|---|---|
| v2.0 | 关闭态落盘改写器（CLI） | ✅ 实现完成，读取侧验收通过 |
| v2.0 | 真机重启后模型侧采信 | ⬜ 待用户实测 |
| v2.1 | 运行态写入（探针先行） | ⬜ 未开工 |
| v2.2 | UI 合一（dsh 插件形态） | ⬜ 未开工 |

已落地的代码：

- `src/session-log.mjs` —— 只读层（多帧 zstd JSONL 解析、正文块收窄），
  从 v1 移植，自带 52 个真实会话的解析验证史；
- `src/session-write.mjs` —— 写入器核心：指纹寻址、剥签名、多帧重组、
  原子写、写后自读校验；
- `src/checkout.mjs` —— 会话副本检出的公共逻辑；
- `scripts/forge-session.mjs` —— v2.0 写入 CLI（含 `--dry-run` / `--restore` /
  dsh 运行中拒绝写入）；
- `scripts/host-oracle.mjs` —— 宿主预言机：用宿主自己的 dsh 起 slim host，
  直连 RPC 读回改写后的会话，双跑（伪造 vs 原始）有区分度；
- `scripts/provider-oracle.mjs` —— 照抄 App 真实启动配方起完整 desktop
  profile，读 provider 注册表（用于定位 13 渠道故障）；
- `scripts/session-anatomy.mjs` —— 会话解剖 / 上下文预算体检（只读），
  回答「这个会话还能不能继续对话」；
- `scripts/frame-anatomy.mjs` —— 帧结构解剖辅助工具。

测试 **25/25**：`session-log` 11 + `session-write` 7 + `session-anatomy` 7。

## 与 v1 的关系

| | v1（dsh-reply-forge） | v2（本仓库） |
|---|---|---|
| 伪造层 | 浏览器渲染层（localStorage 覆盖） | 会话落盘记录（zstd JSONL） |
| 模型可见 | 否 | **是** |
| 落盘文件 | 一个字节都不碰 | 受控改写（带备份/回滚） |
| 适用 | 录屏/演示/截图 | 让模型采信伪造上下文 |

`src/session-log.mjs` 是从 v1 移植的只读层（多帧 zstd JSONL 解析、
assistant/message 文本块收窄），作为 v2 写入器的地基，自带 52 个真实
会话的解析验证史。
