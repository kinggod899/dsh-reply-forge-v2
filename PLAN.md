# dsh-reply-forge-v2 设计与分期

> 2026-10-15 立项。本文是 v2 的主设计文档，随实测推进更新。

## 0. 三大目标 → 技术命题

| 目标 | 技术命题 | 现状 |
|---|---|---|
| 加载不崩溃 | bundle/patch/注册 id 契约零失误 | v1 用一次启动失败换来了完整 checklist（§1） |
| 模型认同 | 伪造正文进入会话上下文 + 过签名校验 | 路径已锁定：落盘改写 + thinkingSignature 剥离走降级通道（§2） |
| 还能继续对话 | 改写不破坏会话完整性与宿主状态机 | 最大风险项，需副本 round-trip 实测（§3） |

## 1. 目标 1：加载不崩溃（契约 checklist）

v1 的教训直接转化成的硬规则：

1. **注册 id 必须等于 package.json 的 name**（v1 崩过一次：构建器写死
   `dsh-reply-forge`，包名却是 `@local/dsh-reply-forge`，内核 arrive()
   硬校验失败 → 启动死）。v2 构建器从 package.json 读 name；
2. **bundle patch 只 insert 不修改**既有条目；`dsh.bundle.patch` 字段
   string/array 两种形态都要兼容（老版 app-boot 只吃 string）；
3. client half 保持**零依赖、无 JSX、无 `export default`/动态 import**
   （自研内联器的限制，v1 构建契约）；
4. **与 v1 隔离**：v2 用独立 id（`@local/dsh-reply-forge-v2`）、独立
   localStorage 键前缀（`dsh-reply-forge-v2:*`）、独立 class 前缀。
   两个插件同时启用会重复挂 UI——文档明示「测试 v2 前先禁用 v1」
   （`启用插件.bat` 的逆操作）；
5. 启动验证链：Node 复现 registry（图里有行）→ combo bundle 200 →
   浏览器 `window.__dshReplyForgeV2` 存在 → 真机启动不崩。

## 2. 目标 2：模型认同（机制）

### 2.1 为什么不能正面伪造

thinking 签名与块绑定 + 前缀绑定：改动正文 → 下一轮请求签名校验失败，
host 拒发。这是密码学约束，绕不过去。

### 2.2 官方降级通道（已实证）

dsh 的 pi-ai 序列化器：thinking 块**无 signature 字段**时，自动降级为
纯 text 发送——不走签名校验。所以「编辑 text 正文 + 剥掉同事件
reasoning/thinking 块的 signature」= 过校验。

### 2.3 写入位置：落盘会话文件

- 文件：`<DSH_HOME>/sessions/<workspace-slug>/<session>/session.v4.jsonl.zstd`
  （多帧 zstd，每帧一个 JSONL 批次；`node:zlib` 可解可编）；
- 只改 `assistant/message` 事件的 text 块——tool/result 事件才是 text
  块大头（约占全部 text 块的七成），绝不碰；system/message 同样不碰；
- 指纹寻址（正文哈希）而非 seq 行号，容忍帧重排。

### 2.4 生效时机

- **关闭态写入**（v2.0）：dsh 未运行时改写 → 重启后打开会话即生效。
  无竞态，最稳；
- **运行态写入**（v2.1，需实测）：宿主持有会话是否有热重载、写盘会不会
  被内存态覆盖。若宿主按 seq 追加读，则改用「追加修正事件」而非重写旧帧。

## 3. 目标 3：还能继续对话（完整性约束）

改写一次的 session 文件必须仍然是一个**合法且可继续**的会话：

1. `seq` 连续、事件壳完整（type/data/id 字段不动，只换 text 块内容）；
2. 投影（tokenUsage/turnOutline/title 等）允许与内容不一致——宿主持
   会话时按 asOfSeq 重算，但需实测不一致时的容错（v2.0 验证项）；
3. 宿主能正常打开该会话、能继续发消息并收到流式回复；
4. 任何一步失败 → 从 `.bak-forge-<ts>` 整文件还原，还原路径本身有测试；
5. **写后自读**：写完立刻用独立解析器读回，分类校验通过才算成功。

## 4. 分期

### v2.0 关闭态落盘改写器（CLI 优先）

- `forge-session.mjs`：`--session <id> --fingerprint <fp> --text "<新正文>"`
  或 `--match "<原文子串>"`；备份 → 解帧 → 定位 → 替换 → 剥签名 →
  组帧写回 → 自读校验；
- 帧策略**已实测**：真实会话副本（数百帧 / 千级事件 / 数十个正文块）
  round-trip 通过——原样重组多帧（preserve）被宿主完整读出，见 §6；
- 测试：真实会话副本 round-trip（解析→改→写→再解析）+ 沙箱 host 打开
  副本不报错（后者已由 §6 的宿主预言机完成）。

### v2.1 运行态写入（探针先行）

- 探针：沙箱 host 运行中改副本文件 → 观察宿主是否重读/覆盖；
- 若可热加载：把写入器接进 UI 保存链；若不可：UI 保存落盘时提示
  「重启后生效」。

### v2.2 UI 合一（dsh 插件形态）—— ✅ 已实现（2026-10-15，见 §9）

- 复用 v1 的 UI 模式（chat.node 槽位 + markdown 容器 + 就地编辑器），
  但持久化目标改为「写入会话记录」；
- 编辑器保存出口二选一：`仅本机渲染`/`写入会话记录`（后者带不可逆警示）；
- 写入前检测 dsh 是否在运行（运行中→提示重启生效或走 v2.1 通道）。

## 5. 待评审点

1. ~~**帧策略**（v2.0 阻塞项）~~ **已决**：多帧重组（preserve）通过宿主
   预言机验证，定为默认；merge 单帧保留为对照策略；
2. v2 是否保留 v1 的「本机渲染覆盖」作为 UI 预览层（我的建议：保留，
   保存即同时写渲染覆盖 + 落盘，视觉零延迟）；
3. 剥签名粒度：仅被编辑消息所在事件 vs 整文件统一剥（建议前者，
   影响面最小）。

## 6. 实证记录：宿主预言机（2026-10-15）

`scripts/host-oracle.mjs`：把 `DSH_HOME` 指向临时家目录（`sessions/` 里
放改写后的会话副本），用**宿主自己的 dsh 安装**起一个 slim host
（只保留 `@deepseek-ai/dsh-base` + `dsh-web-app` 两层），直连 RPC 读回：

1. `session/list` → 拿到 sessionId（`blank=false`：宿主认这个会话）；
2. `session/page` → 拿到宿主读出的历史事件。

双跑结果（同一真实会话，伪造版 vs 原始版）：

| 组 | 宿主启动 | 会话可见 | 宿主游标 | 伪造文本 |
|---|---|---|---|---|
| 伪造副本 | ✅ | ✅ | 与副本事件数一致 | ✅ 伪造的 `assistant/message` 被读出 → **PASS** |
| 原始副本 | ✅ | ✅ | 与副本事件数一致 | ❌ → **FAIL（exit 2）** |

结论：宿主读取器**接受**我们改写的多帧 zstd 日志，且能把伪造正文作为
正常 `assistant/message` 事件读出；预言机对伪造/原始有区分度（对照组
必 FAIL）。这坐实了目标 2（模型认同）与目标 3（还能继续对话）的
**读取侧**前提——宿主读到的就是我们写进去的内容。

配方踩坑（详见脚本头注释）：
- `boot()` 的 `patches` 是「叠加在 config 树上的 overlay」，把含 `include:`
  的 bundle 层叠到已合成的 `cordis.yml` 上 → `duplicate loader entry id: timer`。
  正解：空 leaf 配置 + `loadProfileDirectory` 取层；
- 裸包名解析基 `bareModuleBaseUrl` 必须指向 dsh 安装目录（App 自带安装里
  有开发 checkout 缺的包，如 `@deepseek-ai/dsh-agent-preset`）；
- `?token=` 只对根路径 GET 有效 → 先换签名 cookie，后续 API 走 cookie；
- `session/projections` 只回 baseline 投影（无 `turnOutline`），
  拿真实历史要用 `session/page`（`throughSeq` 不得越过宿主游标）。

尚未覆盖（v2.0 剩余验收项）：真机重启 dsh 打开会话，确认**模型侧**采信
（伪造正文进入下一轮请求上下文）并能继续对话。

> 注：上面第 2 条「`bareModuleBaseUrl` 指向 dsh 安装目录」是 **slim host 的
> 权宜做法**。App 的真实做法根本不传这个参数——见 §7，它靠
> `PluginPackages + createRuntimeResolution` 做双锚点解析。

## 7. 实证记录：provider 预言机与 13 渠道故障（2026-10-15）

`scripts/provider-oracle.mjs`：照抄 App 的真实启动配方
（`@deepseek-ai/dsh/lib/profile-boot-*.js` 的 `runProfile`）无头起**完整
desktop profile**，然后直连 RPC 读出 dsh 注册了哪些 provider。

### 7.1 真实启动配方（三个必踩点）

1. `ctx.baseUrl` 来自**配置文件所在目录**。把 leaf 写进 `tmp/` 会让裸包名
   `dsh-our-free-model` 解析不到 → `failed to import`（**假故障**，会误导
   成插件坏了）。正解：`rootConfig = <profile>/cordis.yml`（内容就是 `[]`）。
2. 双锚点解析**不是** `boot()` 的参数，而是 prepare 里挂的
   `hostCtx.plugin(PluginPackages, { resolution: await createRuntimeResolution({ installAnchor, profile }) })`。
   实测 `resolution` 有数百条（installation 占大头，profile 占小头）。
3. 必须先 `hostCtx.provide('profileContext', …)`，否则 `readProfilePatches`
   原样返回裸包名，且 `dsh-base` 里 `disabled: !!js "!ctx.get('profileContext')"`
   的 desktop 专属条目会被整片关掉。

### 7.2 故障定位链（NO_ADAPTER → 各渠道无模型）

| 观察 | 结论 |
|---|---|
| `~/.dsh/profiles/desktop/.plugin-manager/logs/operation-<host-id>/pnpm.log` 报 `ERR_PNPM_EPERM` | 插件包目录被 pnpm 的失败 rename 清掉 |
| 无头起 profile → `our-free-model: failed to import`（早期误判） | **假象**：leaf 在 tmp，见 7.1-1 |
| 用真实配方后 `llm/listProviders` 全部就位 | 各渠道 provider **全部注册**（渠道名略） |
| 但 `session/modelCatalog` 只有几组 | `buildModelCatalog` 会丢掉 `models.length === 0` 的 provider |
| `credentials.resolve(ref)` 逐个 OK | 凭据链路正常，不是登录问题 |
| pack.js `listModels` 首行 `providerCatalogVisible(...)` | 闸门：`accountPool.hasLoggedInAccount(provider)` |
| `settings.register` 存在 → pack 走 SettingsStore（命名空间空）→ accounts=0 | 账号池读到 0 个账号 → 各渠道全部 `listModels → []` |
| 强制回落 FileStore（读 `~/.dsh/channel-pack/state.json`） | **provider 全部带模型**（每渠道账号/模型数从几到数百不等，此处打码） |

结论：**各渠道的可用性完全取决于账号池能否读到 `~/.dsh/channel-pack/state.json`**；
包目录补回后插件宿主半身、渠道包（`channels: ready`）、全部适配器、全部凭据
都正常。App 侧当次重登时写过 `state.json`（mtime 对得上），证明真实 App 走的是
FileStore 分支。

### 7.3 顺带查明的两件事

- `settings.json` 里的 `hideChannelModels` 是**孤儿键**：v2.1.0 的
  `index.js`/`client.js`/`pack.js` 都不读它；真正的开关是环境变量
  `DSH_HIDE_MODELS_WITHOUT_ACCOUNT`（默认开，即「无账号就隐藏模型」）。
- 个别账号 token 已过期（均为 `refreshable: true`，按需续期）；个别渠道当次
  的几次调用全部报错。

### 7.4 复现命令

```bash
node scripts/provider-oracle.mjs --port 3098              # 默认：真实配方全 profile
PROVIDER_ORACLE_FILESTORE=1 node scripts/provider-oracle.mjs  # 强制 FileStore 分支
node scripts/provider-oracle.mjs --wait 120               # 排除冷启动时序
PROVIDER_ORACLE_BOOT=1 …                                  # 打印 boot 期全部输出
```

## 8. 会话解剖 / 上下文预算体检（2026-10-15）

`scripts/session-anatomy.mjs` —— 目标 3「还能继续对话」的仪表。**只读**。

### 8.1 有效上下文口径（本会话确立）

`inputTokens + cacheReadTokens + cacheWriteTokens`。**只加 `inputTokens` 会严重
低估**：缓存命中的部分不进 `inputTokens`。实测锚点（某真实会话，已打码）：

| turn | provider/model | input | cacheRead | 有效上下文 |
|---|---|---|---|---|
| 2 | 模型甲 | 157 | ~186,300 | ~186,500 |
| 3 | 模型甲 | 2,450 | ~195,100 | ~197,500 |
| 4 | 模型乙 | 2,091 | ~254,400 | ~256,500 |
| 5 | 模型丙 | 860 | ~317,300 | ~318,200 |
| 8 | 模型丁 | ~505,700 | ~21,600 | **~527,300** |

### 8.2 定案：`CONTEXT_WINDOW_EXCEEDED` 与「改写导致超限」无关

用户报告「被你改写的那个对话后续无法继续」。实测证据链：

1. 备份 vs 当前，**共有事件只有 1 个不同**：某条 `assistant/message`，
   正文 **约 1,400 → 140 字符**。改写让上下文**变小**。
2. 所有 `reasoning` 块签名数 = 0（无签名被剥除）；`compaction` 事件 0 个。
3. 报错发生在**另一个会话**（`session-<A>`，`parentSession = session-<B>`，
   `isSeeded: true` —— 用户从被改写会话**分叉**出来的）。
4. 该会话 turn 8 在 **1M 窗口的模型**上成功跑完，宿主自报上下文已达
   **约 52.7 万 tokens**。
5. 约 50 分钟后用户切到一个上游声明 10 万窗口的模型 →
   turn 9/10 `CONTEXT_WINDOW_EXCEEDED`；**compaction 三次全失败**（同一 400，
   压缩请求自己也超限 → 自锁，小窗口模型救不回来）。
6. 该会话字符构成：`reasoning 约 70 万 / text 约 8 千 / tool-result 约 51 万`
   —— 有效内容里 **约九成是推理**，`reasoning` 是全部 assistant 正文的 90 倍。

→ 根因是**会话自己膨胀到约 527K tokens 后被切到了 100K 窗口的模型**，不是改写。

### 8.3 工具设计上的两个修正

- **`--json` 模式原本恒 `exit 0`**，blocker 也返回 0，与文本模式的退出码口径
  不一致（脚本链式判断会失效）。现在两种模式**共用同一退出码**：
  blocker → 2 / 正常 → 0 / 找不到文件 → 1。
- 分析逻辑抽成 `analyzeSession()`（纯函数）、CLI 抽成 `runCli(argv, io)`
  （可注入 stdout/stderr），CLI 只是薄壳。**测试因此直接 import，不 spawn
  子进程**——本沙箱禁止 node 进程再 spawn（`EBUSY`，连 `cmd.exe` 都起不来）。

### 8.4 复现命令

```bash
node scripts/session-anatomy.mjs --list                     # 全部会话，按 mtime 倒序
node scripts/session-anatomy.mjs --session <会话id>          # 文本报告
node scripts/session-anatomy.mjs --session <会话id> --json   # 机器可读
node scripts/session-anatomy.mjs --file <会话文件> --marker FORGE-OK  # 查伪造痕迹
```

## 9. v2.2 实现记录：UI 合一（2026-10-15）

把 v2.0 的落盘改写从 CLI 搬进 dsh 插件形态：在回复下方挂操作条 → 就地编辑
→ 一个按钮写进会话记录。设计上遇到并解决了四个真问题。

### 9.1 核心难题：浏览器算不出写入器的指纹

v1/v2.0 都用「正文哈希」寻址（`sha256(normalize(text)).slice(0,16)`）。
但**浏览器只有渲染后的 DOM 文本，磁盘上是 markdown 源码**——`**粗体**`
渲染成「粗体」，两者对不上，UI 侧**永远算不出**同一个指纹。

→ 改用**「事件 `seq` + 块索引」寻址**：这两个值从只读路由读到的磁盘数据里
原样带出来，与内容无关，天然稳定。`locateTargets()` 因此支持三种寻址，
优先级 **`seq`+`blockIndex` > `fingerprint` > `match`**；`seq` 给定时指纹被
完全忽略（有测试固定这条语义）。

### 9.2 陈旧校验：`expectText`

界面可能开很久，或同一会话在别处被改过——此时 `seq` 还在，但磁盘上的正文
已经变了。不校验就会把「用户以为在改 A」的编辑写到 B 上。

→ `forgeSession({ expectText })`：与磁盘当前文本**逐字节比对**，不符即抛
`STALE_TARGET`（带 `actual` / `expected`），**一个字都不写、连备份都不建**。
UI 侧捕获后提示「内容已过期，请刷新后重试」。

### 9.3 POST 路由可行（照抄 dsh-tavern 的生产用法）

读写都走 `ctx.webServer.register({ kind: 'exact', path, handler })`，handler
收原生 node `req`/`res`，**POST 可用**（判 `req.method` + 自读 body）。写路由
三重闸门：自定义头 `x-rf2-forge: 1`（挡掉跨站表单）、参数校验、`newText`
超 512K 拒绝；**业务失败一律 200 + `ok:false`**，把 HTTP 状态码留给「请求
本身不合法」。

依赖用相对路径 `../../src/session-log.mjs` 引到仓库根的写入内核——单一事实
来源，前提是插件以 junction 安装（`node_modules/@local/dsh-reply-forge-v2 →
<本仓库根目录>`），此时相对路径仍落在同一棵目录树里。

### 9.4 从 v1 移植时修掉的四个真 bug

| bug | 症状 | 修法 |
|---|---|---|
| `pickAssistantBlocks` 幂等守卫跳过已接管块 | **全接管后返回空列表** → 快捷键 `Alt+Shift+E` 静默失效（**v1 就有**） | 新增 `includeTaken` 选项，枚举用途传 `true` |
| 正文访问器把自身 UI 算进正文 | 编辑框预填内容混入「伪造回复」按钮文字 → 落盘定位全退化成「按顺序推断」 | 新增 `ownText()`，递归排除 `OWN_UI_CLASSES` 与 `BUTTON`/`TEXTAREA` |
| 提示写进「已展开进 DOM 的数组」 | 写入失败的提示**永远不显示** | 建独立 `notes` 容器再 `append` |
| `.rf-primary` 是类选择器但代码设 `data-*` 属性 | **死样式**，主按钮从来就没有样式 | 改用属性选择器 `[data-rf2-primary]` |

`applyOverride()` 会清空块的所有子节点，所以操作条必须在覆盖之后重建——
抽出 `attachBar()` 统一处理，避免「已接管但无操作条」的中间态。

### 9.5 安装链路（沿用 v1 的教训）

铁律不变：**dsh 运行时绝不执行 `pnpm install`**（2026-10-14 事故根因）。
`scripts/install.mjs` 只做静态配置改动：

1. 建 junction（`fs.symlinkSync(target, dest, 'junction')`——Windows 下无需
   管理员权限，也不必 spawn `mklink`）；
2. `package.json` 写 `dependencies` + 追加 `dsh.profile.bundles`；
3. **手工登记 `pnpm-lock.yaml` 条目**——不登记的话，将来任何一次 pnpm 对账
   都会把这条 link 判为多余并删掉；
4. 清掉 `cordis.patch.yml` 里两个插件可能残留的 `disabled` 条目。

**只在真要写文件时才做备份**，所以重复执行不堆垃圾（v1 的脚本每次跑都产生
3 份备份，攒了 20 多个）。全程幂等，演练 + 实机各验证过一次。

两个插件同时启用会挂两条操作条，所以安装脚本默认把 v1 从 bundles 摘掉，
但**保留 v1 的依赖与 junction**——v1 随时能秒开回来，不需要重装。

### 9.6 测试

| 套件 | 数量 | 覆盖 |
|---|---|---|
| `session-log` | 11 | 多帧解析、正文块收窄 |
| `session-write` | 15 | 指纹/match 寻址、**seq 寻址**、**`expectText` 陈旧拒绝**、剥签名、dry-run、merge、tool/result 不可寻址 |
| `session-anatomy` | 7 | 上下文预算体检、退出码口径 |
| `client` | 23 | 走构建产物 `client.js`：操作条、编辑器双出口、二次确认、陈旧提示、快捷键、调试命名空间 |
| `routes` | 15 | 两条路由：目录穿越、缺头 403、缺参 400、超长 413、正常写入、陈旧拒绝、越界拒绝 |
| `build` | 2 | 产物与源码一致；产物里不得出现仓库绝对路径的编码形态（构建可移植） |

### 9.6.1 构建可移植性（发行前发现，2026-10-16）

打包发行版时暴露：`build-client.mjs` 的 `safeId()` 用**绝对路径**生成模块前缀
（`path.replace(...).slice(-40)`），于是仓库装在哪里决定产物字节。仓库自己
`--check` 照样过，只有把包解到别处才炸——解开后 `--check` 失败、重建产物不一致。
换目录构建必须字节等价，否则每个克隆者都会得到不同的 `client.js`。

修法：`safeId` 改吃**相对仓库根的路径**，`slice(-40)` 一并去掉（相对路径本来就短）。
`tests/build.test.mjs` 钉住两条：`generate({check:true})` 必须过；产物里不得出现
本仓库绝对路径的编码形态（把旧版 safeId 换回去，两条都会红）。异地（把包解到
`/tmp` 再建）实测：`--check` 过、产物字节一致。

### 9.7 真机验证暴露的两个 bug：会话 id 从哪来（2026-10-15 晚）

v2.2 装进 desktop profile 后用户实测：**每条回复都提示「未在会话记录中定位到
这条回复，无法写入记录」，只有 `仅本机渲染` 能用。** 排查出两个 bug，都指向
同一个根源：**会话 id 是猜来的**。

#### Bug 1：`currentSessionId()` 解析的是 URL，而 dsh 的 URL 里没有会话 id

原实现靠正则从 `window.location.pathname` 里抠 `/session/<id>`。查了宿主的
`@deepseek-ai/dsh-client-ui-conversation/lib/client.js`（716 KB）：
`location` / `history` / `pushState` / `hashchange` **一次都没出现**——dsh 是
单页应用，切换会话只改内存状态，不碰 URL。所以 `currentSessionId()` 永远返回
`_global`，读路由拿它去查文件必然 404，`blocks` 为空，于是**每一条都定位不到**。

v1 为什么没暴露：它只用这个 id 给 localStorage 分桶，`_global` 也能凑合
（所有会话共用一个桶，只是覆盖会串——v1 已知的「重名共享」现象）。
v2 要拿 id 去查会话文件，必须拿到真值。

**正解**：宿主把当前会话 id 渲染在 DOM 上——
```js
"data-conversation-session": sessionId   // client.js:16333
```
挂在带 `data-conversation-region="chat"` 的容器上。所以 `currentSessionId()`
改为**先查 DOM**，URL 只作兜底。

#### Bug 2：会话记录后到，而 `scan()` 跳过已接管块，定位永不刷新

`takeBlock()` 对已接管块直接 `return`；而 `scan()` 调
`pickAssistantBlocks()` 时**没传 `includeTaken`**，于是已接管块被整个跳过——
第二轮扫描枚举到 0 个块，`blockMatch` 永远停在上一次的值上。

时序上必然踩雷：首屏扫描时记录请求还没回来 → 块以 `match=null` 接管完 →
记录到达 → 重新扫描 → 已接管的块全被跳过 → **定位永远停在 null**。

这两个 bug 叠加，正好就是用户看到的现象。修法：

1. `currentSessionId(doc)` 先读 `[data-conversation-session]`；
2. `scan()` 改用 `{ includeTaken: true }` 枚举，`takeBlock()` 对已接管块
   **仍然刷新定位**（`blockMatch` + 重建操作条），并用 `sameMatch()` 判断
   是否需要动手，保持幂等；
3. `runScan()` 每轮重算会话 id（切会话不触发任何 URL 事件，必须靠 DOM）；
4. 会话 id 改成「用的时候现取」：操作条/编辑器传 `getSessionId` 而不是值，
   避免切会话后点按钮去读写上一个会话；
5. 占位 id 不发请求（必然 404，只会刷噪音）；
6. 编辑器把**失败原因分开讲**：`会话未识别` / `正在读取` / `读取失败(带原因)` /
   `记录为空` / `这条对不上(带记录规模)`。原来五者共用一句话，是排查困难的
   直接原因。

真机数据验证（某真实会话，千级事件 / 数十个正文块）：读路由 200、
两种 id 写法（裸 uuid / `session-` 前缀）都命中、**全部正文块可寻址**
（大半精确 + 少量顺序推断兜底，0 个对不上）。

| 测试 | 覆盖 |
|---|---|
| `会话 id 取自 DOM 的 data-conversation-session` | bug 1 主来源 |
| `容器未挂载时用占位值不发请求，DOM 出现后自动升级` | 首屏时序 + bug 2 |
| `记录里有正文但这条对不上` | 五种失败原因的正确分支（兜底只配尾部） |
| `记录读取失败 → 把真实错误显示出来` | 失败原因可诊断 |

→ **测试 69/69**（client 18 → 21）。

合计 **66/66**。`client.test.mjs` 与 `routes.test.mjs` 是 v2.2 新增；
`routes.test.mjs` 直接调 route handler（`DSH_HOME` 指临时目录），走真实文件系统。


### 9.8 真机 bug #3：伪造第一条之后，后面的回复全部定位不上（2026-10-15 晚）

用户原话：「会话内第一条回复伪造完毕后，后面的对话都无法编辑了」。
截图提示走的是 `.dsh-plugin/client/index.mjs` 里 `rec.blocks.length > 0`
那一支：**「记录里有 1 条正文」**。

#### 取证

盘上只有一处当日 forge 痕迹：`session-<伪造目标>`（工作区 `<workspace-slug>`），
备份 `*.bak-forge-<时间戳>`。

| 文件 | 事件 | assistant/message | assistant text 块 |
|---|---|---|---|
| 备份（伪造前） | ~100 | 十余 | **1** |
| 当前（伪造后） | ~120 | 十余 | **3** |

三个关键事实：

1. **读路由本身没问题**：服务端每次请求都重新读盘、不过滤不缓存
   （`.dsh-plugin/server/routes.mjs` 的 handler 直调 `readSessionEvents`）。
2. **「1」正是伪造那一刻的快照**：备份里只有 1 个 text 块（某条长回复，
   用户把它伪造成一段测试用的短文本）。伪造成功后客户端
   `resetCache` + `loadRecord(force)` 重读 → 缓存里**还是 1 块**。
3. **会话是增长的，缓存不是**：宿主随后又生成了两条新回复。
   DOM 里已经有 3 条正文，缓存里始终是伪造那一刻的 1 块 →
   `matchBlocks` 用旧快照比对，后两条永远 `null` → 编辑器按
   「记录里有 1 条正文，对不上」禁用落盘出口。

#### 根因

**落盘记录的浏览器侧缓存只在三种情况下失效**：首次拉起、写入成功、
用户点「重新读取」。会话持续增长时它不会自己更新。伪造第一条正好触发
一次强制重读，之后每一条新回复都永久拿旧快照在比对。

宿主的落盘节奏（读 `dsh-session-persistence-jsonl/lib/index.js` 的
`enqueueLive`）会放大这个窗口：事件先 `buffered.push`，再
`setTimeout(..., 200)` 批处理落盘——**DOM 渲染永远领先磁盘最多数百毫秒**。
所以这不是偶发时序，而是「伪造过第一条之后就必然复发」。

#### 修法（v2.2.1）

1. `record.mjs` 新增 `recordNeedsRefresh(entry, domBlockCount)`：
   判据只有一条且是**单调**的——页面上的助手正文块比记录里多。
   正常会话里页面块数 ≤ 记录块数（历史可能被虚拟化折叠，记录反而更多），
   所以不会误报；页面比记录新只可能是记录过期或宿主还没落盘。
2. `index.mjs` 的 `scan()` 末尾调用它，过期就后台 `readRecord(force)`
   （按 sessionId 去重，避免流式期间把读记录打成高频请求），
   读完 `scheduleScan()` 自旋一轮把定位补上。
3. **编辑器也不再当场宣判**：打开时若记录明显比页面旧，先显示
   「⏳ 正在重新读取…」，重读完用同一批 DOM 文本重新 `matchBlocks`，
   命中就地把定位状态改成 ✓ 并放开落盘出口。记录为空/读失败是终态，
   不触发这套逻辑（原提示保留，用户仍可点「重新读取」）。
4. 双重退避：`RECORD_REFRESH_MIN_GAP_MS`(800ms) 时间间隔 +
   `RECORD_REFRESH_MAX_TRIES`(4) 连续无果；**页面块数再次变化立即解除退避**，
   不会被一次「读不到」永久堵死。
5. `readRecord()` 统一走模块级 `recordInflight` 去重；`scheduleScanRef` /
   `refreshRecordRef` 两个注入点供模块级的 `openBlockEditor` / `scan()`
   够到 `apply()` 闭包里的状态。

模块级函数拿不到 `apply()` 闭包这件事本身踩了一次：第一版直接在
`scan()` 里调 `refreshRecordIfStale`，被自己的 try/catch 吞掉，
测试报「没有自动重读」才发现。

#### 真机数据复核（同一会话）

用真实文件复算：磁盘 3 块 / 页面 3 块 → 三条**全部
`exact=true`**；「磁盘 1 / 页面 3」的旧快照场景下 `recordNeedsRefresh`
判定为 true（会重读到 3 块并补上定位）。即修复后该会话后续回复可正常写入。

#### 测试（client 21 → 23）

| 测试 | 覆盖 |
|---|---|
| `页面比记录新 → 自动重读并把定位补上` | bug 主路径：新回复进 DOM 后自行恢复可写 |
| `编辑器打开时记录是旧快照 → 先重读再下结论` | 编辑器不当场误判 |
| `记录里有正文但这条对不上`（改） | 自动重读跑完仍是误判时才给最终警示 |

→ **73/73**（另有 `build` 2 条构建契约测试，见 §9.6.1）。
