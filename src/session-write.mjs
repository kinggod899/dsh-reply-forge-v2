// 会话落盘写入器（v2 核心模块）。
//
// 安全契约（任何一条不满足就拒绝写）：
//   1. **只改** `assistant/message` 事件里 `type==='text'` 的块，且必须
//      命中目标（指纹或子串）；`tool/result`、`system/message` 等一概不碰
//      （真实 schema 里 1395/2011 个 text 块在 tool/result 事件里）；
//   2. 命中事件的 reasoning/thinking 块**剥掉 signature/thinkingSignature**
//      （默认仅该事件；--strip-scope 可扩到全文）——宿主 pi-ai 的降级通道
//      据此把 thinking 降级成纯 text 发送，绕过签名校验；
//   3. 写前整文件备份（`.bak-forge-<ts>`）；原子写（临时文件 + rename）；
//      写后**自读校验**，任一不过 → 自动从备份还原并抛错；
//   4. 帧策略 `preserve`（默认）：逐帧解压→改行→重压，帧数量与顺序不变，
//      宿主的追加式写帧语义不受影响。`merge`：合并为单帧（对照组，等宿主
//      读取兼容性实测后再决定是否启用）。
//
// 零依赖、纯 ESM（与 v1 构建契约一致，便于将来并入 client half）。

import { readFileSync, writeFileSync, renameSync, copyFileSync, existsSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { scanZstdFrames, readSessionEvents } from './session-log.mjs'

/** 正文指纹：规范化空白后取 sha256 前 16 位（与内容一一对应即可寻址）。 */
export function fingerprint(text) {
  const norm = String(text ?? '').replace(/\s+/g, ' ').trim()
  return createHash('sha256').update(norm, 'utf8').digest('hex').slice(0, 16)
}

/** 事件里的助手正文 text 块索引（只认 assistant/message 的 text 块）。 */
export function assistantTextBlockRefs(event) {
  if (event === null || typeof event !== 'object') return []
  if (event.type !== 'assistant/message') return []
  const content = event?.data?.message?.content
  if (Array.isArray(content) === false) return []
  const out = []
  content.forEach((block, i) => {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      out.push({ blockIndex: i, text: block.text, fingerprint: fingerprint(block.text) })
    }
  })
  return out
}

/**
 * 把会话文件解成「帧 × 行」模型。行保持原文（字节级），可解析事件才进 event。
 * @param {string} file
 * @returns {{frames:Array<{start:number,end:number,trailingNewline:boolean}>,lines:Array<{frame:number,text:string,event:object|null,bad:boolean}>}}
 */
export function loadLines(file) {
  const buf = readFileSync(file)
  const frames = scanZstdFrames(buf)
  const lines = []
  const frameMeta = []
  frames.forEach((fr, fi) => {
    const raw = zstdDecompressSync(buf.subarray(fr.start, fr.end)).toString('utf8')
    const trailingNewline = raw.endsWith('\n')
    const parts = trailingNewline ? raw.slice(0, -1).split('\n') : raw.split('\n')
    frameMeta.push({ start: fr.start, end: fr.end, trailingNewline })
    for (const text of parts) {
      let event = null
      let bad = false
      if (text.trim() !== '') {
        try { event = JSON.parse(text) } catch { bad = true }
      }
      lines.push({ frame: fi, text, event, bad })
    }
  })
  return { frames: frameMeta, lines }
}

/**
 * 在行模型里定位目标 text 块。
 * @param {Array} lines loadLines 产物
 * @param {{fingerprint?:string, match?:string}} where 二选一
 * @returns {Array<{line:number,blockIndex:number,seq:number|null,text:string,fingerprint:string}>}
 */
export function locateTargets(lines, where = {}) {
  const hits = []
  lines.forEach((ln, i) => {
    if (ln.bad || ln.event === null) return
    for (const ref of assistantTextBlockRefs(ln.event)) {
      if (where.fingerprint !== undefined) {
        if (ref.fingerprint !== where.fingerprint) continue
      } else if (where.match !== undefined) {
        if (!ref.text.includes(where.match)) continue
      } else {
        continue
      }
      hits.push({
        line: i,
        blockIndex: ref.blockIndex,
        seq: typeof ln.event.seq === 'number' ? ln.event.seq : null,
        text: ref.text,
        fingerprint: ref.fingerprint,
      })
    }
  })
  return hits
}

/** 剥掉事件内 reasoning/thinking 块的签名字段，返回剥离计数。 */
export function stripSignaturesInEvent(event, scope = 'same-event') {
  if (event === null || typeof event !== 'object') return 0
  const content = event?.data?.message?.content
  if (Array.isArray(content) === false) return 0
  if (scope === 'none') return 0
  let n = 0
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    if (block.type !== 'thinking' && block.type !== 'reasoning') continue
    for (const key of ['signature', 'thinkingSignature']) {
      if (key in block) { delete block[key]; n += 1 }
    }
  }
  return n
}

/** 全文剥签名（strip-scope=all 用）：返回剥离计数。 */
function stripSignaturesAll(lines) {
  let n = 0
  for (const ln of lines) {
    if (ln.event === null) continue
    if (ln.event.type !== 'assistant/message') continue
    n += stripSignaturesInEvent(ln.event, 'same-event')
  }
  return n
}

/** 重新序列化行（event 非空且被改过的行才重写，其余保持原文）。 */
function reserialize(lines, dirty) {
  for (const i of dirty) {
    const ln = lines[i]
    if (ln.event !== null) ln.text = JSON.stringify(ln.event)
  }
}

/** 按帧策略重组缓冲区。 */
function rebuild(file, loaded, lines, strategy) {
  if (strategy === 'merge') {
    const text = lines.map(l => l.text).join('\n') + '\n'
    return Buffer.concat([zstdCompressSync(Buffer.from(text, 'utf8'))])
  }
  // preserve：逐帧重压。帧的 trailingNewline 语义保持原样。
  const byFrame = new Map()
  lines.forEach(l => {
    if (!byFrame.has(l.frame)) byFrame.set(l.frame, [])
    byFrame.get(l.frame).push(l.text)
  })
  const chunks = []
  for (let fi = 0; fi < loaded.frames.length; fi += 1) {
    const meta = loaded.frames[fi]
    const parts = byFrame.get(fi) ?? []
    let text = parts.join('\n')
    if (meta.trailingNewline && text !== '') text += '\n'
    else if (meta.trailingNewline && text === '') text = '\n'
    chunks.push(zstdCompressSync(Buffer.from(text, 'utf8')))
  }
  void file
  return Buffer.concat(chunks)
}

/** 自读校验：解析、事件数、seq 连续、新文本在、旧文本不在。 */
function selfVerify(file, expect) {
  const events = readSessionEvents(file)
  const blocks = []
  for (const ev of events) {
    if (ev?.type !== 'assistant/message') continue
    const content = ev?.data?.message?.content
    if (Array.isArray(content) === false) continue
    for (const b of content) {
      if (b?.type === 'text' && typeof b.text === 'string') blocks.push(b.text)
    }
  }
  if (events.length !== expect.eventCount) {
    throw new Error(`自读校验失败：事件数 ${events.length} ≠ 预期 ${expect.eventCount}`)
  }
  const seqs = events.map(e => (typeof e.seq === 'number' ? e.seq : null)).filter(s => s !== null)
  for (let i = 1; i < seqs.length; i += 1) {
    if (seqs[i] <= seqs[i - 1]) throw new Error(`自读校验失败：seq 非严格递增（${seqs[i - 1]} → ${seqs[i]}）`)
  }
  if (!blocks.some(t => t.includes(expect.newText))) {
    throw new Error('自读校验失败：新正文未出现在任何 assistant text 块')
  }
  if (expect.oldText !== undefined && blocks.some(t => t === expect.oldText)) {
    throw new Error('自读校验失败：旧正文仍然存在')
  }
  return { events: events.length, blocks: blocks.length }
}

/**
 * 执行一次伪造写入。
 * @param {string} file 会话文件路径
 * @param {{fingerprint?:string,match?:string,newText:string,strategy?:'preserve'|'merge',stripScope?:'same-event'|'all'|'none',dryRun?:boolean}} opts
 * @returns {{ok:boolean,dryRun:boolean,targets:Array,stripped:number,backup?:string,verify?:object,strategy:string}}
 */
export function forgeSession(file, opts) {
  const strategy = opts.strategy ?? 'preserve'
  const stripScope = opts.stripScope ?? 'same-event'
  if (typeof opts.newText !== 'string' || opts.newText.trim() === '') {
    throw new Error('newText 不能为空')
  }
  if (existsSync(file) === false) throw new Error('会话文件不存在：' + file)

  const originalEvents = readSessionEvents(file)
  const loaded = loadLines(file)
  const targets = locateTargets(loaded.lines, { fingerprint: opts.fingerprint, match: opts.match })
  if (targets.length === 0) {
    throw new Error('未命中任何 assistant/message text 块（fingerprint/match 无匹配）')
  }
  if (targets.length > 1 && opts.fingerprint === undefined) {
    const list = targets.map(t => `  line#${t.line} seq=${t.seq} fp=${t.fingerprint} 「${t.text.replace(/\s+/g, ' ').slice(0, 40)}…」`).join('\n')
    throw new Error('match 命中多个块，请改用 --fingerprint 精确定位：\n' + list)
  }

  // 应用编辑
  const dirty = new Set()
  let stripped = 0
  for (const t of targets) {
    const ln = loaded.lines[t.line]
    const content = ln.event.data.message.content
    const block = content[t.blockIndex]
    if (block === undefined || block.type !== 'text') throw new Error('目标块不是 text（内部错误）')
    block.text = opts.newText
    dirty.add(t.line)
    stripped += stripSignaturesInEvent(ln.event, stripScope)
  }
  if (stripScope === 'all') stripped += stripSignaturesAll(loaded.lines)
  reserialize(loaded.lines, dirty)

  if (opts.dryRun === true) {
    return {
      ok: true,
      dryRun: true,
      strategy,
      targets,
      stripped,
      wouldChangeLines: [...dirty].sort((a, b) => a - b),
      frameCount: loaded.frames.length,
    }
  }

  // 备份 → 原子写 → 自读校验（失败自动还原）
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = file + '.bak-forge-' + stamp
  copyFileSync(file, backup)
  const bs = statSync(backup)
  if (bs.size === 0) throw new Error('备份文件为空，拒绝写入')

  const tmp = file + '.forge-tmp'
  writeFileSync(tmp, rebuild(file, loaded, loaded.lines, strategy))
  const oldText = targets[0].text
  try {
    renameSync(tmp, file)
    const verify = selfVerify(file, {
      eventCount: originalEvents.length,
      newText: opts.newText,
      oldText: targets.length === 1 ? oldText : undefined,
    })
    return { ok: true, dryRun: false, strategy, targets, stripped, backup, verify }
  } catch (err) {
    // 自读不过 → 还原
    copyFileSync(backup, file)
    try { if (existsSync(tmp)) renameSync(tmp, tmp + '.failed-' + stamp) } catch { /* 忽略 */ }
    const wrapped = new Error('写入后自读校验失败，已从备份还原：' + err.message)
    wrapped.backup = backup
    throw wrapped
  }
}

export { readSessionEvents, scanZstdFrames }
