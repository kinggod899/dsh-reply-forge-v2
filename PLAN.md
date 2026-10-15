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
  块大头（1395/2011），绝不碰；system/message 同样不碰；
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
- 帧策略**待实测**：原样重组多帧 vs 合并单帧（用真实会话副本各试一次，
  看宿主读取结果，再定默认）；
- 测试：真实会话副本 round-trip（解析→改→写→再解析）+ 沙箱 host 打开
  副本不报错。

### v2.1 运行态写入（探针先行）

- 探针：沙箱 host 运行中改副本文件 → 观察宿主是否重读/覆盖；
- 若可热加载：把写入器接进 UI 保存链；若不可：UI 保存落盘时提示
  「重启后生效」。

### v2.2 UI 合一（dsh 插件形态）

- 复用 v1 的 UI 模式（chat.node 槽位 + markdown 容器 + 就地编辑器），
  但持久化目标改为「写入会话记录」；
- 编辑器保存出口二选一：`仅本机渲染`/`写入会话记录`（后者带不可逆警示）；
- 写入前检测 dsh 是否在运行（运行中→提示重启生效或走 v2.1 通道）。

## 5. 待评审点

1. **帧策略**（v2.0 阻塞项）：多帧重组 vs 合并单帧——先实测；
2. v2 是否保留 v1 的「本机渲染覆盖」作为 UI 预览层（我的建议：保留，
   保存即同时写渲染覆盖 + 落盘，视觉零延迟）；
3. 剥签名粒度：仅被编辑消息所在事件 vs 整文件统一剥（建议前者，
   影响面最小）。
