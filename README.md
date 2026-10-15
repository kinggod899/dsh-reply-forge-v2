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

**v2.0 与 v2.2 已实现；v2.2 已安装进 desktop profile，等重启 DSH 生效。**
设计与实证见 [PLAN.md](PLAN.md)。

| 阶段 | 内容 | 状态 |
|---|---|---|
| v2.0 | 关闭态落盘改写器（CLI） | ✅ 实现完成，读取侧验收通过 |
| v2.0 | 真机重启后模型侧采信 | ✅ 用户实测通过（编辑内容被大模型认可） |
| v2.1 | 运行态写入（探针先行） | ⬜ 未开工 |
| v2.2 | UI 合一（dsh 插件形态） | ✅ 实现完成，已安装，待重启验证 |
| v2.2 | 真机重启后 UI 生效 | ⬜ 待用户实测 |

已落地的代码：

**写入内核（纯 ESM、零依赖）**

- `src/session-log.mjs` —— 只读层（多帧 zstd JSONL 解析、正文块收窄），
  从 v1 移植，自带 52 个真实会话的解析验证史；
- `src/session-write.mjs` —— 写入器核心：**seq+块索引 / 指纹**双寻址、
  `expectText` 陈旧校验、剥签名、多帧重组、原子写、写后自读校验；
- `src/checkout.mjs` —— 会话副本检出的公共逻辑。

**插件形态（v2.2）**

- `.dsh-plugin/index.mjs` —— host half：只声明 `inject: ['webServer']`，
  `apply()` 全程 try/catch，任何异常都不会拖垮宿主启动；
- `.dsh-plugin/server/routes.mjs` —— 两条 HTTP 路由：读块列表 / 执行写入。
  写路由带自定义头校验、参数校验、超长拒绝，业务失败一律 200 + `ok:false`；
- `.dsh-plugin/client/index.mjs` —— client half：在每条助手回复下挂操作条，
  就地编辑器双出口（`仅本机渲染` / `写入会话记录`）；
- `.dsh-plugin/client/record.mjs` —— 磁盘记录访问层 + DOM↔磁盘两级匹配；
- `.dsh-plugin/client/{picker,markdown,classify,store,styles}.mjs` ——
  从 v1 移植的 UI 模块（前缀全部改为 `rf2-`，与 v1 严格隔离）；
- `.dsh-plugin/client.js` —— 构建产物（由 `scripts/build-client.mjs` 内联）。

**脚本**

- `scripts/forge-session.mjs` —— v2.0 写入 CLI（含 `--dry-run` / `--restore` /
  `--seq` / `--block-index` / dsh 运行中拒绝写入）；
- `scripts/install.mjs` / `enable.mjs` / `disable.mjs` / `profile-lib.mjs` ——
  安装 / 启用 / 关闭（**只改静态配置，绝不跑 pnpm**）；
- `scripts/build-client.mjs` —— client half 内联构建器（`--check` 校验新鲜度）；
- `scripts/host-oracle.mjs` —— 宿主预言机：用宿主自己的 dsh 起 slim host，
  直连 RPC 读回改写后的会话，双跑（伪造 vs 原始）有区分度；
- `scripts/provider-oracle.mjs` —— 照抄 App 真实启动配方起完整 desktop
  profile，读 provider 注册表（用于定位 13 渠道故障）；
- `scripts/session-anatomy.mjs` —— 会话解剖 / 上下文预算体检（只读），
  回答「这个会话还能不能继续对话」；
- `scripts/frame-anatomy.mjs` —— 帧结构解剖辅助工具。

测试 **66/66**：`session-log` 11 + `session-write` 15 + `session-anatomy` 7 +
`client` 18 + `routes` 15。跑法：

```bash
for f in tests/*.test.mjs; do node "$f"; done
node scripts/build-client.mjs --check   # client.js 与源码是否一致
```

## 安装 / 启用 / 关闭

三个一键脚本（双击即可，不需要命令行）：

| 文件 | 作用 |
|---|---|
| `安装插件.bat` | 首次安装：建链接、写依赖、登记 lockfile、加入 bundles |
| `启用插件.bat` | 已装但被关掉时，加回 bundles（不需要重新安装） |
| `关闭插件.bat` | 停用：从 bundles 摘掉（保留链接与依赖，可秒开回来） |

三者都**只修改 dsh 启动时读取的静态配置**，不执行 pnpm。安装脚本默认会
顺手把 v1 从 bundles 里摘掉（两个插件同时启用会挂出两条操作条），但保留
v1 的依赖与链接，v1 用它自己的 `启用插件.bat` 就能开回来。想两个都开：
`node scripts/install.mjs --keep-v1`。

**改完必须完全退出并重启 DSH 才生效。**

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
