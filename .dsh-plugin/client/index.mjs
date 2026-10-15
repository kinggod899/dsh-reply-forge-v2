/** dsh-reply-forge v2 浏览器 half：在会话消息上挂就地编辑入口，并支持写入落盘记录。
 *
 * 与 v1 的差别只有一个，但是根本性的：**保存有两个出口**。
 *   - 「仅本机渲染」：只写 localStorage，改的是页面，模型看不见（v1 的能力）；
 *   - 「写入会话记录」：改写会话落盘文件，模型下一轮读到的就是伪造内容。
 * 后者不可逆（有自动备份可还原），且**需要重启 DSH 才对模型生效**——
 * 运行中的宿主把会话持在内存里，改盘不会被它读到。这一点必须在界面上说清楚。
 *
 * 与其它插件共存的四条纪律（承自 v1）：
 *  1. 只注入，不注册。不向任何共享槽位注册条目，UI 完全由 DOM 注入实现。
 *  2. 命名隔离。样式类 rf2-*、属性 data-rf2-*、存储键 dsh-reply-forge-v2:*。
 *  3. 幂等接管。每个消息节点带 data-rf2-taken 标记，宿主重渲染后自然重新接管。
 *  4. 不阻断。任何一步异常都就地吞掉并记日志，绝不让宿主渲染失败。
 *
 * 契约（官方 bundle 插件 client half）：export name / inject / apply。
 */

import { CSS } from './styles.mjs'
import { CONVERSATION_SELECTOR, TAKEN_ATTR, pickAssistantBlocks, conversationRoot } from './picker.mjs'
import { renderMarkdown } from './markdown.mjs'
import { classifyNaturalLanguage } from './classify.mjs'
import {
  currentSessionId, isPlaceholderSession, fingerprint, loadOverrides, setOverride,
  removeOverride, clearOverrides, loadPrefs, savePrefs,
} from './store.mjs'
import {
  loadRecord, cachedRecord, resetCache, matchBlocks, normalizeText, forgeRecord,
} from './record.mjs'

export const name = 'dsh-reply-forge-v2'

/** 依赖服务：槽位系统（仅用于等待宿主就绪，不注册条目）。 */
export const inject = ['slots']

const SCAN_DEBOUNCE_MS = 220
const EDIT_ATTR = 'data-rf2-edited'

/** 本插件自己注入的 UI 类名。取正文时必须跳过它们。 */
const OWN_UI_CLASSES = ['rf2-bar', 'rf2-editor', 'rf2-note', 'rf2-notes']

/** 已接管的节点 → 覆盖指纹，供撤销时定位。 */
const taken = new WeakMap()

/** 已接管的节点 → 与它正文完全相同的消息条数（>1 时编辑器给共享覆盖警示）。 */
const dupCount = new WeakMap()

/** 已接管的节点 → 落盘记录里的对应块（null = 没对上，落盘出口禁用）。 */
const blockMatch = new WeakMap()

/** 编辑态：同一时刻只允许一个编辑器打开。 */
let openEditor = null

function log(...args) {
  try { console.warn('[dsh-reply-forge-v2]', ...args) } catch { /* 忽略 */ }
}

/** 是否为本插件注入的 UI 节点。 */
function isOwnUi(el) {
  const cls = el.classList
  if (cls === undefined || cls === null) return false
  for (const name of OWN_UI_CLASSES) if (cls.contains(name)) return true
  return false
}

/**
 * 取节点内**不属于本插件 UI** 的文本（规范化空白）。
 *
 * 为什么不能直接用 textContent：接管后我们往块里塞了操作条与提示行，
 * 它们的文字会被算进「正文」，于是下一轮扫描算出的文本与磁盘对不上，
 * 精确匹配全部失效、退化成按顺序猜位置。这个坑在 v1 就存在（编辑框里
 * 会莫名多出「伪造回复」四个字），v2 里因为要拿它比对落盘记录，
 * 后果从「难看」升级成「定位错误」，所以必须从根上解决。
 */
function ownText(el) {
  const kids = el.children ?? []
  if (kids.length === 0) return String(el.textContent ?? '').replace(/\s+/g, ' ').trim()
  let out = ''
  for (const child of kids) {
    if (isOwnUi(child)) continue
    if (child.tagName === 'TEXTAREA' || child.tagName === 'BUTTON') continue
    out += ownText(child) + ' '
  }
  return out.replace(/\s+/g, ' ').trim()
}

/** 建一个按钮。 */
function makeButton(doc, label, title, onClick, extra = {}) {
  const btn = doc.createElement('button')
  btn.type = 'button'
  btn.className = 'rf2-btn'
  btn.textContent = label
  if (typeof title === 'string' && title !== '') btn.title = title
  for (const [k, v] of Object.entries(extra)) {
    if (v === true) btn.setAttribute(k, '')
    else if (v !== false && v !== null && v !== undefined) btn.setAttribute(k, String(v))
  }
  btn.addEventListener('click', event => {
    event.preventDefault()
    event.stopPropagation()
    try { onClick() } catch (error) { log('按钮回调失败', error) }
  })
  return btn
}

/** 关闭当前编辑器（有未保存改动时丢弃）。 */
function closeEditor() {
  if (openEditor === null) return
  const { wrap } = openEditor
  openEditor = null
  try { wrap.remove() } catch { /* 忽略 */ }
}

/**
 * 拆除本插件注入的全部 UI（操作条、编辑器、定位上下文），
 * 但保留监听与覆盖数据 —— 供 setEnabled(false) 实时停用后重新启用。
 */
function stripInjectedUI() {
  closeEditor()
  for (const el of [...document.querySelectorAll('[' + TAKEN_ATTR + ']')]) {
    el.removeAttribute(TAKEN_ATTR)
    el.removeAttribute(EDIT_ATTR)
    if (el.classList !== undefined && el.classList.contains('rf2-host')) el.classList.remove('rf2-host')
    for (const own of [...el.querySelectorAll('.rf2-bar, .rf2-editor, .rf2-note')]) own.remove()
  }
}

/** 原文缓存：指纹 → 原文，供「还原」时重建。 */
const originals = new Map()

function rememberOriginal(fp, text) {
  if (typeof fp !== 'string') return
  if (!originals.has(fp)) originals.set(fp, text)
}

function fpOriginal(block, fp) {
  return originals.get(fp) ?? ownText(block)
}

/** 一条状态行（定位结果 / 写入结果）。 */
function makeNote(doc, kind, text) {
  const el = doc.createElement('div')
  el.className = 'rf2-note rf2-note-' + kind
  el.textContent = text
  return el
}

/**
 * 把覆盖文本应用到节点：清空宿主渲染结果，换成本插件渲染的 Markdown。
 *
 * 注意它会**连操作条一起清掉**（block 的子节点被整体重置），调用方必须
 * 紧接着重新 attachBar，否则块会处于「已接管但没有操作条」的中间态——
 * 扫描器会把它当作需要重新接管，而那时的正文已被换成渲染结果，
 * 拿它去比对磁盘就会错位。
 */
function applyOverride(block, text, prefs, docOverride) {
  block.textContent = ''
  renderMarkdown(block, text, docOverride ?? block.ownerDocument)
  if (prefs.autoMark === true) block.setAttribute(EDIT_ATTR, '')
  else block.removeAttribute(EDIT_ATTR)
}

/**
 * 挂（或重建）操作条。幂等：已存在就清空重建，不产生第二条。
 *
 * 传 `getSessionId` 而不是 `sessionId` 值：宿主切会话时不改 URL，我们靠
 * DOM 属性发现切换，而操作条是**在旧节点上**挂的——若把 id 固定在闭包里，
 * 切换后点「伪造回复」就会去读/写上一个会话。每次用的时候现取才安全。
 * @returns {HTMLElement} 操作条节点
 */
function attachBar(block, doc, getSessionId, prefs, match) {
  let bar = null
  for (const child of (block.children ?? [])) {
    if (child.classList !== undefined && child.classList.contains('rf2-bar')) { bar = child; break }
  }
  if (bar === null) {
    bar = doc.createElement('div')
    bar.className = 'rf2-bar'
    block.append(bar)
  }
  bar.textContent = ''

  const sessionId = getSessionId()
  const fp = taken.get(block)
  const forgeBtn = makeButton(doc, '伪造回复', '就地编辑这条 AI 回复', () => openBlockEditor(block, getSessionId, prefs, doc))
  if (match !== null && match !== undefined) forgeBtn.setAttribute('data-rf2-linked', '')
  bar.append(forgeBtn)

  const override = fp === undefined ? undefined : loadOverrides(sessionId)[fp]
  if (override !== undefined && typeof override.text === 'string') {
    bar.append(makeButton(doc, '还原', '删除本条本机覆盖', () => {
      removeOverride(sessionId, fp)
      block.removeAttribute(EDIT_ATTR)
      applyOverride(block, fpOriginal(block, fp), prefs, doc)
      attachBar(block, doc, getSessionId, prefs, match)
    }, { 'data-active': true }))
  }
  return bar
}

/**
 * 打开编辑器：把一块消息就地换成 textarea，并提供两个保存出口。
 * 会话 id 在**打开这一刻**解析一次并固定：编辑器是模态的，开着的期间
 * 用户不会同时切会话。
 */
function openBlockEditor(block, getSessionId, prefs, docOverride) {
  closeEditor()
  const sessionId = getSessionId()
  const doc = docOverride ?? block.ownerDocument ?? document
  const match = blockMatch.get(block) ?? null

  // 初值取「当前显示的正文」：有本机覆盖就是覆盖内容，否则是块里非本插件 UI 的文本。
  const blockFp = taken.get(block)
  const applied = blockFp === undefined ? undefined : loadOverrides(sessionId)[blockFp]
  const original = (applied !== undefined && typeof applied.text === 'string')
    ? applied.text
    : ownText(block)

  const wrap = doc.createElement('div')
  wrap.className = 'rf2-editor'

  const label = doc.createElement('div')
  label.className = 'rf2-hint'
  label.textContent = '编辑 AI 回复'

  const area = doc.createElement('textarea')
  area.value = original
  area.spellcheck = false
  area.setAttribute('aria-label', '编辑 AI 回复')

  const row = doc.createElement('div')
  row.className = 'rf2-row'

  const status = doc.createElement('span')
  status.className = 'rf2-hint'
  status.textContent = 'Ctrl+Enter 保存 · Esc 取消'

  const spacer = doc.createElement('span')
  spacer.className = 'rf2-spacer'

  // 状态行容器：定位结果与写入结果都往里追加。
  // 注意不能往「已经展开进 DOM 的数组」里 push —— 那样新节点根本不在文档里
  // （踩过：写入失败的提示永远不显示）。
  const notes = doc.createElement('div')
  notes.className = 'rf2-notes'

  const head = [label, notes]

  // 指纹重名警示：宿主不提供稳定消息 id，正文完全相同的两条消息会共享
  // 同一条本机覆盖。落盘出口不受影响（走 seq 寻址），必须分别说明。
  const dup = dupCount.get(block) ?? 1
  if (dup > 1) {
    notes.append(makeNote(doc, 'warn',
      '⚠ 本会话有 ' + dup + ' 条正文完全相同的消息。本机渲染覆盖由它们共享；'
      + '写入会话记录只作用于当前这一条。'))
  }

  // ── 落盘定位状态 ────────────────────────────────────────────────────────
  // 定位不到就不给落盘出口：宁可少一个按钮，也不能猜个位置去写。
  // 失败原因要分开讲——「记录没读到」「记录是空的」「这条对不上」是三件
  // 完全不同的事，全都显示同一句话会让排查变成猜谜（踩过）。
  if (match === null) {
    const rec = cachedRecord(sessionId)
    if (isPlaceholderSession(sessionId)) {
      notes.append(makeNote(doc, 'warn',
        '⚠ 还没识别出当前会话（会话容器尚未就绪）。稍等片刻，或点「重新读取」。'))
    } else if (rec === null) {
      notes.append(makeNote(doc, 'warn', '⚠ 正在读取会话记录…稍后重开本编辑器。'))
    } else if (rec.error !== null) {
      notes.append(makeNote(doc, 'warn',
        '⚠ 读取会话记录失败：' + rec.error + '（点「重新读取」重试）'))
    } else if (rec.blocks.length === 0) {
      notes.append(makeNote(doc, 'warn',
        '⚠ 会话记录里没有可定位的助手正文（这个会话可能还没落盘过）。'))
    } else {
      notes.append(makeNote(doc, 'warn',
        '⚠ 未在会话记录中定位到这条回复（记录里有 ' + rec.blocks.length + ' 条正文，'
        + '可能是含公式/表格/代码等渲染差异导致对不上）。'))
    }
  } else if (match.exact !== true) {
    notes.append(makeNote(doc, 'warn',
      '⚠ 与记录中的位置是按顺序推断的（seq=' + match.seq + '），未做内容比对。'
      + '写入前请确认正文无误。'))
  } else {
    notes.append(makeNote(doc, 'ok', '✓ 已定位到会话记录 seq=' + match.seq + '（块 ' + match.blockIndex + '）'))
  }

  const cancel = makeButton(doc, '取消', '放弃改动', () => closeEditor())

  const refresh = makeButton(doc, '重新读取', '重新读取会话记录并重新定位', () => {
    resetCache(sessionId)
    closeEditor()
    loadRecord(sessionId, { force: true })
      .then(() => scheduleScan())
      .catch(error => log('重新读取失败', error))
  })

  const reset = makeButton(doc, '还原原文', '删除本条本机覆盖', () => {
    const fp = taken.get(block)
    if (typeof fp === 'string') {
      removeOverride(sessionId, fp)
      block.removeAttribute(EDIT_ATTR)
      applyOverride(block, fpOriginal(block, fp), prefs, doc)
      attachBar(block, doc, getSessionId, prefs, match)
    }
    closeEditor()
  }, { 'data-danger': true })

  const saveLocal = makeButton(doc, '仅本机渲染', '只改本页显示，模型看不见（Ctrl+Enter）', () => {
    const next = area.value
    const fp = taken.get(block) ?? fingerprint(original)
    setOverride(sessionId, fp, next)
    applyOverride(block, next, prefs, doc)
    attachBar(block, doc, getSessionId, prefs, match)
    closeEditor()
  })

  const saveRecord = makeButton(doc, '写入会话记录', '改写会话落盘文件，模型可见（需重启 DSH 生效）', () => {
    const next = area.value
    if (normalizeText(next) === normalizeText(original)) {
      status.textContent = '内容没有变化。'
      return
    }
    if (confirmWrite(next) !== true) return
    status.textContent = '正在写入…'
    saveRecord.disabled = true
    saveLocal.disabled = true
    forgeRecord({
      sessionId,
      seq: match.seq,
      blockIndex: match.blockIndex,
      newText: next,
      expectText: match.text,
    }).then(res => {
      saveRecord.disabled = false
      saveLocal.disabled = false
      if (res.ok !== true) {
        // 失败时编辑器保持打开，用户可以直接改完重试。
        status.textContent = ''
        const stale = res.code === 'STALE_TARGET'
        notes.append(makeNote(doc, 'warn', '✖ ' + (res.error || '写入失败')
          + (stale ? '（记录里的正文已被改动，点「重新读取」后重试）' : '')))
        return
      }
      // 写盘成功后同步一份本机覆盖：界面立刻看到结果，且与记录一致。
      const fp = taken.get(block) ?? fingerprint(original)
      setOverride(sessionId, fp, next)
      // applyOverride 会连编辑器一起清掉，所以顺序是：先换正文、再关编辑器、再重建操作条。
      applyOverride(block, next, prefs, doc)
      closeEditor()
      attachBar(block, doc, getSessionId, prefs, match)
      // 记录已变，缓存作废，重新读一遍让后续定位对得上。
      resetCache(sessionId)
      loadRecord(sessionId, { force: true }).then(() => scheduleScan()).catch(() => {})
      const done = '✓ 已写入会话记录 · 重启 DSH 后模型生效'
        + (typeof res.backup === 'string' ? ' · 备份：' + res.backup : '')
      block.append(makeNote(doc, 'ok', done))
    }).catch(error => {
      saveRecord.disabled = false
      saveLocal.disabled = false
      status.textContent = '写入异常：' + String((error && error.message) || error)
    })
  }, { 'data-rf2-primary': true })

  row.append(status, spacer, refresh, reset, cancel, saveLocal, saveRecord)
  if (match === null) saveRecord.disabled = true
  wrap.append(...head, area, row)

  block.append(wrap)
  try { area.focus() } catch { /* 忽略 */ }

  area.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.stopPropagation(); closeEditor(); return }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      event.stopPropagation()
      // Ctrl+Enter = 本机渲染（可逆、无风险）；落盘改写必须用鼠标点，
      // 免得手快把一个不可逆操作顺手做了。
      saveLocal.click()
    }
  })

  openEditor = { wrap, block }
}

/** 落盘写入前的二次确认：不可逆 + 需重启生效，两点都要讲。 */
function confirmWrite(newText) {
  const preview = String(newText).replace(/\s+/g, ' ').slice(0, 120)
  return window.confirm(
    '确认改写会话记录？\n\n'
    + '新正文：' + preview + (newText.length > 120 ? '…' : '') + '\n\n'
    + '· 会改动会话落盘文件，并自动备份（可还原）\n'
    + '· 写入后需要重启 DSH 才会对模型生效\n'
    + '· 重启前不要在这个会话继续对话：宿主内存里还是旧内容，\n'
    + '  这一轮模型读到的会是原文（看起来像「改了没用」）；\n'
    + '  宿主重写会话时也可能覆盖掉这次改动。\n'
    + '  重启之后就可以正常继续聊了。',
  )
}

/** 两个定位结果是否等价（只比寻址字段，不比正文省内存）。 */
function sameMatch(a, b) {
  if (a === b) return true
  if (a === null || b === null || a === undefined || b === undefined) return false
  return a.seq === b.seq && a.blockIndex === b.blockIndex && a.exact === b.exact
}

/**
 * 接管一个消息节点：挂操作条 + 应用已有覆盖。
 */
function takeBlock(block, getSessionId, overrides, prefs, docOverride, dup = 1, match = null) {
  // 文档对象由扫描器显式传入：ownerDocument 在合成节点上可能缺失，
  // 隐式全局 document 在打包后的模块作用域里也未必可见。
  const doc = docOverride ?? block.ownerDocument ?? document

  // 已接管：**定位结果必须刷新**。会话记录是异步后到的（首屏扫描往往还没
  // 拉到），若不刷新，块会永远停留在接管那一刻的 match=null 上——
  // 表现就是「每条回复都定位不到，落盘出口全程禁用」。踩过。
  if (block.hasAttribute(TAKEN_ATTR)) {
    if (sameMatch(blockMatch.get(block) ?? null, match ?? null)) return
    blockMatch.set(block, match)
    attachBar(block, doc, getSessionId, prefs, match)
    return
  }

  const original = ownText(block)
  const fp = fingerprint(original)
  rememberOriginal(fp, original)
  taken.set(block, fp)
  dupCount.set(block, dup)
  blockMatch.set(block, match)
  block.setAttribute(TAKEN_ATTR, '')

  // 定位上下文：无条件添加——读 computed style 再判断既慢（流式重渲染时
  // 每个节点一次样式计算）又不可靠（祖先已定位时 position 未必是 static），
  // 而 .rf2-host 的 position:relative 对宿主布局无影响。
  block.classList.add('rf2-host')

  attachBar(block, doc, getSessionId, prefs, match)
  const override = overrides[fp]
  if (override !== undefined && typeof override.text === 'string') {
    applyOverride(block, override.text, prefs, doc)
    attachBar(block, doc, getSessionId, prefs, match)
  }
}

/** 一轮扫描：接管当前所有助手消息块，并刷新落盘定位。 */
function scan(getSessionId, prefs, docOverride) {
  // 全局开关：停用时不提供任何编辑入口（setEnabled(false) 的实时效果）。
  if (prefs.enabled === false) return
  const doc = docOverride ?? document
  const root = conversationRoot(doc)
  if (root === null) return
  const sessionId = getSessionId()
  const overrides = loadOverrides(sessionId)
  // 只接管纯自然语言块，工具调用/结构化动作不提供编辑入口。
  //
  // 必须 includeTaken：已接管的块也要枚举回来。不是为了重挂操作条
  // （takeBlock 会早退），而是为了**刷新落盘定位**——会话记录是异步
  // 后到的，首屏扫描时块已经以 match=null 接管完；若此后扫描把已接管块
  // 全跳过，定位就永远停在 null，表现是「每条回复都定位不到、落盘出口
  // 全程禁用」。踩过。
  const blocks = pickAssistantBlocks(root, classifyNaturalLanguage, { includeTaken: true })

  // 指纹重数统计：先数重再接管，编辑器里对重名者给出警示。
  const texts = blocks.map(ownText)
  const fps = new Map()
  const counts = new Map()
  for (const block of blocks) {
    const fp = fingerprint(ownText(block))
    fps.set(block, fp)
    counts.set(fp, (counts.get(fp) ?? 0) + 1)
  }

  // 落盘定位：把页面上这一批块与磁盘块配对。记录没拉到就全部按「未定位」处理，
  // 落盘出口禁用——不猜位置。
  const rec = cachedRecord(sessionId)
  const matches = (rec !== null && rec.error === null && rec.blocks.length > 0)
    ? matchBlocks(rec.blocks, texts)
    : blocks.map(() => null)

  blocks.forEach((block, i) => {
    try {
      takeBlock(block, getSessionId, overrides, prefs, doc, counts.get(fps.get(block)) ?? 1, matches[i] ?? null)
    } catch (error) {
      log('接管消息块失败', error)
    }
  })
}

/**
 * 插件入口：注入样式、启动扫描与会话级操作。
 * @param ctx - client 根上下文（提供 slots 服务）。
 */
export function apply(ctx) {
  // 幂等守卫：重复执行（HMR / loader 重跑）不重复注入。
  if (document.querySelector('style[data-dsh-reply-forge-v2]') !== null) return

  const styleEl = document.createElement('style')
  styleEl.setAttribute('data-dsh-reply-forge-v2', '')
  styleEl.setAttribute('data-plugin', 'dsh-reply-forge-v2')
  styleEl.textContent = CSS
  document.head.append(styleEl)

  let prefs = loadPrefs()
  let sessionId = currentSessionId(document)
  /** 会话 id 取「用的时候现读」，不要把它固定进闭包（见 attachBar 注释）。 */
  const getSessionId = () => sessionId

  /** 扫描节流：流式输出期间宿主高频重渲染，按帧合并。 */
  let timer = null
  const scheduleScan = () => {
    if (timer !== null) return
    timer = window.setTimeout(() => {
      timer = null
      try { runScan() } catch (error) { log('扫描失败', error) }
    }, SCAN_DEBOUNCE_MS)
  }

  /** 拉一次落盘记录，拿到后重扫以便刷新定位。 */
  const syncRecord = () => {
    // 还没识别出会话时不发请求：路由必然 404，只会刷一屏没用的噪音。
    if (isPlaceholderSession(sessionId)) return
    loadRecord(sessionId)
      .then(() => scheduleScan())
      .catch(error => log('读取会话记录失败', error))
  }

  /**
   * 每轮扫描都重算会话 id。
   *
   * 为什么不能只在 popstate/hashchange 上挂：dsh 是单页应用，切换会话
   * **不触发任何 URL 事件**（实测 @deepseek-ai/dsh-client-ui-conversation
   * 的 client.js 里 location/history 一次都没出现）。会话 id 只体现在
   * DOM 属性 `data-conversation-session` 上。首屏同理——容器挂载前拿到
   * 的是占位值，挂载后才变成真值，所以必须每轮都重算。
   */
  const runScan = () => {
    const next = currentSessionId(document)
    if (next !== sessionId) {
      // 会话真的变了（首屏就绪 / 切到别的会话）：关掉编辑态、重新拉记录。
      if (isPlaceholderSession(sessionId) === false) closeEditor()
      sessionId = next
      syncRecord()
    }
    scan(getSessionId, prefs, document)
  }

  window.addEventListener('popstate', scheduleScan)
  window.addEventListener('hashchange', scheduleScan)

  // 宿主 DOM 变化驱动接管：会话区子树内的节点增删（新消息、流式定稿、
  // 标签切换重渲染）都会触发。作用域限定在会话锚点内，避免观察整棵树。
  let observedRoot = null
  let observer = null
  const attachObserver = () => {
    const root = document.querySelector(CONVERSATION_SELECTOR)
    if (root === observedRoot) return
    if (observer !== null) { observer.disconnect(); observer = null }
    observedRoot = root
    if (root === null) return
    observer = new MutationObserver(() => scheduleScan())
    observer.observe(root, { childList: true, subtree: true })
    // 锚点刚出现时立刻扫一次：此刻会话里往往已经有历史消息，
    // 而 MutationObserver 只对「之后的」变动触发，不补这一刀就会漏掉首屏。
    scheduleScan()
  }

  // 会话区还没挂载时（首屏 / 版本切换），低频重试直到锚点出现
  const bootstrap = window.setInterval(() => {
    attachObserver()
    if (observedRoot !== null) {
      window.clearInterval(bootstrap)
      scheduleScan()
    }
  }, 600)
  attachObserver()
  syncRecord()

  // 快捷键：Alt+Shift+E 编辑当前视图最后一条 AI 回复
  const onKey = event => {
    if (event.altKey !== true || event.shiftKey !== true) return
    if (typeof event.key !== 'string' || event.key.toLowerCase() !== 'e') return
    const root = conversationRoot(document)
    // includeTaken：快捷键是枚举用途。默认的扫描语义会跳过已接管的块，
    // 于是「所有块都接管完之后按快捷键毫无反应」——静默失效，最难查的那种。
    const blocks = pickAssistantBlocks(root, classifyNaturalLanguage, { includeTaken: true })
    const last = blocks[blocks.length - 1]
    if (last === undefined) return
    event.preventDefault()
    openBlockEditor(last, getSessionId, prefs, document)
  }
  window.addEventListener('keydown', onKey)

  ctx.effect(() => () => {
    window.clearInterval(bootstrap)
    if (timer !== null) window.clearTimeout(timer)
    if (observer !== null) observer.disconnect()
    window.removeEventListener('popstate', scheduleScan)
    window.removeEventListener('hashchange', scheduleScan)
    window.removeEventListener('keydown', onKey)
    stripInjectedUI()
    styleEl.remove()
  }, 'dsh-reply-forge-v2: teardown')

  // 调试命名空间：不注册任何宿主槽位，只在 window 上暴露，供手动排查。
  try {
    window.__dshReplyForgeV2 = {
      version: '2.0.0',
      sessionId() { return sessionId },
      /** 直接从 DOM 现读一次（排查「id 认错了」时对比用）。 */
      domSessionId() { return currentSessionId(document) },
      clearAll() {
        clearOverrides(sessionId)
        log('已清空当前会话的本机覆盖')
      },
      /**
       * 强制重算会话 id + 重读落盘记录（定位不上的时候用）。
       * 会顺带修掉「id 还是首屏占位值」这种状态。
       */
      refresh() {
        sessionId = currentSessionId(document)
        resetCache(sessionId)
        if (isPlaceholderSession(sessionId)) {
          return Promise.resolve({ ok: false, sessionId, error: '未识别出当前会话（DOM 里没有 data-conversation-session）' })
        }
        return loadRecord(sessionId, { force: true }).then(rec => {
          scheduleScan()
          return { ok: rec.error === null, sessionId, blocks: rec.blocks.length, error: rec.error }
        })
      },
      /** 当前页面上各块的落盘定位情况，用于排查「为什么写不了」。 */
      locate() {
        const root = conversationRoot(document)
        // includeTaken：枚举用途，已接管的块也要算进来（否则全接管完就是空列表）。
        const blocks = pickAssistantBlocks(root, classifyNaturalLanguage, { includeTaken: true })
        const rec = cachedRecord(sessionId)
        const head = { sessionId, domSessionId: currentSessionId(document), domBlocks: blocks.length }
        if (rec === null) return { ...head, ok: false, error: '记录未加载' }
        if (rec.error !== null) return { ...head, ok: false, error: rec.error }
        const matches = matchBlocks(rec.blocks, blocks.map(ownText))
        return {
          ...head,
          ok: true,
          diskBlocks: rec.blocks.length,
          matched: matches.filter(m => m !== null).length,
          exact: matches.filter(m => m !== null && m.exact === true).length,
          rows: matches.map((m, i) => ({
            domIndex: i,
            preview: ownText(blocks[i]).slice(0, 40),
            seq: m === null ? null : m.seq,
            blockIndex: m === null ? null : m.blockIndex,
            exact: m === null ? null : m.exact,
          })),
        }
      },
      setEnabled(value) {
        prefs = { ...prefs, enabled: value === true }
        savePrefs(prefs)
        // 实时生效：停用立即拆除已注入的 UI；启用则触发一次扫描补挂。
        if (prefs.enabled) scheduleScan()
        else stripInjectedUI()
      },
    }
  } catch {
    // window 不可写时忽略
  }
}
