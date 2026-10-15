window.__ModuleLoader__.load({
	id: "@local/dsh-reply-forge-v2",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
var __my_forge_v2__dsh_plugin_client_styles_mjs = (function(){ 



const CSS = `
.rf2-btn{
  display:inline-flex;align-items:center;gap:4px;
  height:22px;padding:0 8px;border-radius:6px;
  border:1px solid color-mix(in srgb, currentColor 22%, transparent);
  background:transparent;color:inherit;
  font:inherit;font-size:12px;line-height:1;
  cursor:pointer;opacity:.55;
  transition:opacity .12s, background-color .12s;
  white-space:nowrap;user-select:none;
}
.rf2-btn:hover{opacity:1;background:color-mix(in srgb, currentColor 8%, transparent)}
.rf2-btn:focus-visible{outline:2px solid color-mix(in srgb, currentColor 60%, transparent);outline-offset:1px}
.rf2-btn[data-active]{opacity:1;border-color:color-mix(in srgb, #e0a34a 60%, transparent);color:#e0a34a}

/* 悬浮操作条：绝对定位于消息容器内部，不参与文档流，不改动宿主布局 */
.rf2-bar{
  position:absolute;top:2px;right:6px;z-index:5;
  display:inline-flex;gap:4px;align-items:center;
  opacity:0;pointer-events:none;
  transition:opacity .14s;
}
.rf2-host:hover > .rf2-bar,
.rf2-host:focus-within > .rf2-bar,
.rf2-bar:focus-within{opacity:1;pointer-events:auto}

/* 消息容器需要定位上下文：只在被接管的容器上加，宿主其余节点不受影响 */
.rf2-host{position:relative}
.rf2-host[data-rf2-edited]{box-shadow:inset 2px 0 0 color-mix(in srgb, #e0a34a 70%, transparent)}

.rf2-editor{
  display:flex;flex-direction:column;gap:8px;
  margin:6px 0;padding:10px;border-radius:10px;
  border:1px solid color-mix(in srgb, currentColor 18%, transparent);
  background:color-mix(in srgb, currentColor 4%, transparent);
}
.rf2-editor textarea{
  width:100%;min-height:120px;resize:vertical;
  padding:8px 10px;border-radius:8px;
  border:1px solid color-mix(in srgb, currentColor 20%, transparent);
  background:color-mix(in srgb, currentColor 3%, transparent);
  color:inherit;font:inherit;font-size:13px;line-height:1.6;
}
.rf2-editor textarea:focus-visible{outline:2px solid color-mix(in srgb, currentColor 45%, transparent);outline-offset:1px}
.rf2-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.rf2-spacer{flex:1 1 auto}
.rf2-hint{font-size:11px;opacity:.55}

/* 状态行：定位结果与写入结果都走这里。
   v1 的 .rf-primary / .rf-danger 是**类选择器**，而代码设的是 data-* 属性，
   选择器永远匹配不上（死样式）。v2 统一改成属性选择器。 */
.rf2-note{font-size:11px;line-height:1.5}
.rf2-note-ok{color:#4caf7d}
.rf2-note-warn{color:#e0a34a}
.rf2-note-hint{opacity:.5;word-break:break-all}

.rf2-btn[data-rf2-primary]{
  border-color:color-mix(in srgb, #4f8cff 55%, transparent);
  background:color-mix(in srgb, #4f8cff 14%, transparent);
  color:inherit;opacity:1;
}
.rf2-btn[data-danger]{opacity:.9}
.rf2-btn[data-danger]:hover{border-color:color-mix(in srgb, #d9534f 60%, transparent);color:#d9534f}
.rf2-btn:disabled{opacity:.3;cursor:not-allowed}
.rf2-btn:disabled:hover{background:transparent}

/* 已定位到落盘记录的块：操作条按钮带一个不易察觉的记号，
   让用户一眼看出「这条能写进记录」，而不是点开才发现写不了。 */
.rf2-btn[data-rf2-linked]::before{
  content:'';width:5px;height:5px;border-radius:50%;
  background:#4caf7d;flex:0 0 auto;
}
`

 return { CSS: CSS } })();
var CSS = __my_forge_v2__dsh_plugin_client_styles_mjs.CSS;
var __my_forge_v2__dsh_plugin_client_picker_mjs = (function(){ 


























const CONVERSATION_SELECTOR = '[data-slot="main.conversation"], [data-slot="conversation"]'


const CHAT_NODE_SELECTOR = '[data-slot="conversation.chat.node"]'


const BLOCK_TAGS = 'p, pre, ul, ol, blockquote, h1, h2, h3, h4, h5, h6, table'


const TAKEN_ATTR = 'data-rf2-taken'




const MIN_TEXT = 1
function textLen(el) {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim().length
}








function isMarkdownContainer(el) {
  if (typeof el.matches !== 'function') return false
  const kids = [...el.children]
  if (kids.length === 0) return false
  let blocks = 0
  for (const k of kids) {
    try {
      if (k.matches(BLOCK_TAGS)) blocks += 1
    } catch {
      return false
    }
  }
  return blocks >= 1 && blocks * 2 >= kids.length
}

















function pickAssistantBlocks(root, classify = null, options = {}) {
  if (root === null || typeof root.querySelectorAll !== 'function') return []
  const includeTaken = options.includeTaken === true
  const out = []
  const seen = new Set()

  const consider = el => {
    if (el === null || seen.has(el)) return
    if (el.closest('.rf2-editor, .rf2-bar, textarea, input') !== null) return
    if (typeof el.hasAttribute === 'function' && el.hasAttribute(TAKEN_ATTR)) {
      if (includeTaken === true) {
        
        
      } else if (el.querySelector('.rf2-bar') !== null) {
        
        return
      } else {
        
        
        el.removeAttribute(TAKEN_ATTR)
      }
    }
    seen.add(el)
    out.push(el)
  }

  
  let nodes = []
  try {
    nodes = [...root.querySelectorAll(CHAT_NODE_SELECTOR)]
  } catch {
    nodes = []
  }
  for (const node of nodes) {
    let containers = []
    try {
      containers = [...node.querySelectorAll('*')].filter(isMarkdownContainer)
    } catch {
      containers = []
    }
    
    
    const outermostInNode = containers.filter(el => !containers.some(o => o !== el && o.contains(el)))
    for (const el of outermostInNode) {
      if (textLen(el) < MIN_TEXT) continue
      consider(el)
    }
  }

  
  
  
  if (out.length === 0) {
    const paras = [...root.querySelectorAll('p')]
    for (const p of paras) {
      const host = p.parentElement
      if (host === null) continue
      if (textLen(host) < MIN_TEXT) continue
      consider(host)
    }
  }

  
  const outermost = out.filter(el => !out.some(other => other !== el && other.contains(el)))

  
  
  if (typeof classify !== 'function') return outermost
  return outermost.filter(el => classify(el).ok === true)
}


function conversationRoot(doc = document) {
  const hit = doc.querySelector(CONVERSATION_SELECTOR)
  if (hit !== null) return hit
  
  
  const root = doc.getElementById('root')
  return root ?? doc.body
}

 return { pickAssistantBlocks: pickAssistantBlocks, conversationRoot: conversationRoot, CONVERSATION_SELECTOR: CONVERSATION_SELECTOR, TAKEN_ATTR: TAKEN_ATTR, MIN_TEXT: MIN_TEXT } })();
var CONVERSATION_SELECTOR = __my_forge_v2__dsh_plugin_client_picker_mjs.CONVERSATION_SELECTOR;
var TAKEN_ATTR = __my_forge_v2__dsh_plugin_client_picker_mjs.TAKEN_ATTR;
var pickAssistantBlocks = __my_forge_v2__dsh_plugin_client_picker_mjs.pickAssistantBlocks;
var conversationRoot = __my_forge_v2__dsh_plugin_client_picker_mjs.conversationRoot;
var __mforge_v2__dsh_plugin_client_markdown_mjs = (function(){ 








function inline(doc, text) {
  const frag = doc.createDocumentFragment()
  
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\[[^\]\n]+\]\([^)\n]*\)|(?<![\w*])\*[^*\n]+\*(?![\w*]))/g
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) frag.append(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('`')) {
      const code = doc.createElement('code')
      code.textContent = tok.slice(1, -1)
      frag.append(code)
    } else if (tok.startsWith('**')) {
      const strong = doc.createElement('strong')
      strong.textContent = tok.slice(2, -2)
      frag.append(strong)
    } else if (tok.startsWith('~~')) {
      const del = doc.createElement('del')
      del.textContent = tok.slice(2, -2)
      frag.append(del)
    } else if (tok.startsWith('[')) {
      const hit = /^\[([^\]]+)\]\(([^)]*)\)$/.exec(tok)
      const a = doc.createElement('a')
      if (hit !== null) {
        a.textContent = hit[1]
        const href = hit[2].trim()
        
        if (/^(https?:|mailto:|#|\/|\.)/i.test(href)) {
          a.setAttribute('href', href)
          a.setAttribute('rel', 'noreferrer noopener')
        }
      } else {
        a.textContent = tok
      }
      frag.append(a)
    } else {
      const em = doc.createElement('em')
      em.textContent = tok.slice(1, -1)
      frag.append(em)
    }
    last = m.index + tok.length
  }
  if (last < text.length) frag.append(text.slice(last))
  return frag
}


function splitRow(line) {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells = []
  let buf = ''
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i]
    if (ch === '\\' && inner[i + 1] === '|') { buf += '|'; i += 1; continue }
    if (ch === '|') { cells.push(buf.trim()); buf = ''; continue }
    buf += ch
  }
  cells.push(buf.trim())
  return cells
}

function isDivider(line) {
  return /^\s*\|?[\s:-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes('-')
}






function renderMarkdown(container, source, docOverride) {
  
  
  const doc = docOverride ?? container.ownerDocument ?? globalThis.document
  container.textContent = ''
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n')

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    
    if (line.trim() === '') { i += 1; continue }

    
    const fence = /^\s*```([A-Za-z0-9_+-]*)\s*$/.exec(line)
    if (fence !== null) {
      const lang = fence[1] ?? ''
      const buf = []
      i += 1
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { buf.push(lines[i]); i += 1 }
      i += 1 
      const pre = doc.createElement('pre')
      const code = doc.createElement('code')
      if (lang !== '') code.setAttribute('data-language', lang)
      code.textContent = buf.join('\n')
      pre.append(code)
      container.append(pre)
      continue
    }

    
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      container.append(doc.createElement('hr'))
      i += 1
      continue
    }

    
    const head = /^\s*(#{1,6})\s+(.*)$/.exec(line)
    if (head !== null) {
      const h = doc.createElement('h' + head[1].length)
      h.append(inline(doc, head[2]))
      container.append(h)
      i += 1
      continue
    }

    
    if (line.includes('|') && i + 1 < lines.length && isDivider(lines[i + 1])) {
      const header = splitRow(line)
      i += 2
      const bodyRows = []
      while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
        bodyRows.push(splitRow(lines[i]))
        i += 1
      }
      const table = doc.createElement('table')
      const thead = doc.createElement('thead')
      const htr = doc.createElement('tr')
      for (const cell of header) {
        const th = doc.createElement('th')
        th.append(inline(doc, cell))
        htr.append(th)
      }
      thead.append(htr)
      table.append(thead)
      const tbody = doc.createElement('tbody')
      for (const row of bodyRows) {
        const tr = doc.createElement('tr')
        for (const cell of row) {
          const td = doc.createElement('td')
          td.append(inline(doc, cell))
          tr.append(td)
        }
        tbody.append(tr)
      }
      table.append(tbody)
      container.append(table)
      continue
    }

    
    if (/^\s*>\s?/.test(line)) {
      const buf = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''))
        i += 1
      }
      const quote = doc.createElement('blockquote')
      const inner = doc.createElement('div')
      renderMarkdown(inner, buf.join('\n'))
      quote.append(inner)
      container.append(quote)
      continue
    }

    
    if (/^\s*[-*+]\s+/.test(line)) {
      const list = doc.createElement('ul')
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const li = doc.createElement('li')
        const text = lines[i].replace(/^\s*[-*+]\s+/, '')
        li.append(inline(doc, text))
        i += 1
        
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*[-*+]\s+/.test(lines[i])) {
          li.append(doc.createTextNode(' ' + lines[i].trim()))
          i += 1
        }
        list.append(li)
      }
      container.append(list)
      continue
    }

    
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const list = doc.createElement('ol')
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        const li = doc.createElement('li')
        li.append(inline(doc, lines[i].replace(/^\s*\d+[.)]\s+/, '')))
        i += 1
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*\d+[.)]\s+/.test(lines[i])) {
          li.append(doc.createTextNode(' ' + lines[i].trim()))
          i += 1
        }
        list.append(li)
      }
      container.append(list)
      continue
    }

    
    const buf = []
    while (
      i < lines.length
      && lines[i].trim() !== ''
      && !/^\s*```/.test(lines[i])
      && !/^\s*#{1,6}\s/.test(lines[i])
      && !/^\s*>\s?/.test(lines[i])
      && !/^\s*[-*+]\s+/.test(lines[i])
      && !/^\s*\d+[.)]\s+/.test(lines[i])
      && !/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])
    ) {
      buf.push(lines[i])
      i += 1
    }
    if (buf.length > 0) {
      const p = doc.createElement('p')
      p.append(inline(doc, buf.join('\n')))
      container.append(p)
    } else {
      i += 1
    }
  }
}

 return { renderMarkdown: renderMarkdown } })();
var renderMarkdown = __mforge_v2__dsh_plugin_client_markdown_mjs.renderMarkdown;
var __mforge_v2__dsh_plugin_client_classify_mjs = (function(){ 























const ACTION_TEXT = [
  'tool-call', 'tool_call', 'toolResult', 'tool-result',
  'function_call', 'functionCall',
  '运行命令', '执行命令', '调用工具', '工具调用', '工具结果',
  '写入文件', '修改文件', '创建文件', '删除文件', '读取文件',
  '已应用补丁', '应用补丁',
  'exit code', 'exitCode', 'stdout', 'stderr',
  '等待授权', '需要确认',
]


const ACTION_TAGS = new Set(['button', 'input', 'select', 'textarea', 'iframe'])


const OWN_UI_SELECTOR = '.rf2-bar, .rf2-editor'


const ACTION_SHAPE = [
  /^[A-Za-z]:\\/m,                       
  /^\/(?:Users|home|usr|etc|var|opt)\//m, 
  /^\s*--?[a-z][a-z0-9-]{2,}/m,          
  /^\s*[{[][\s\S]*[\]}]\s*$/,            
  /\$\s+\S+/,                            
]







function stripCode(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
}






function classifyNaturalLanguage(el) {
  if (el === null || el === undefined) return { ok: false, reason: '空节点' }

  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (text.length === 0) return { ok: false, reason: '空文本' }

  
  const lower = stripCode(text).toLowerCase()
  for (const marker of ACTION_TEXT) {
    if (lower.includes(marker.toLowerCase())) {
      return { ok: false, reason: '含结构化动作痕迹：' + marker }
    }
  }

  
  let structural = null
  try {
    for (const tag of ACTION_TAGS) {
      const hit = el.querySelector(tag)
      if (hit !== null && hit.closest?.(OWN_UI_SELECTOR) === null) { structural = tag; break }
    }
  } catch {
    
  }
  if (structural !== null) {
    return { ok: false, reason: '含结构性元素 <' + structural + '>' }
  }

  
  for (const re of ACTION_SHAPE) {
    if (re.test(stripCode(text))) return { ok: false, reason: '形态像命令或结构化数据' }
  }

  return { ok: true, reason: '纯自然语言' }
}






function partitionEditable(blocks) {
  const editable = []
  const rejected = []
  for (const el of blocks) {
    const verdict = classifyNaturalLanguage(el)
    if (verdict.ok) editable.push(el)
    else rejected.push({ el, reason: verdict.reason })
  }
  return { editable, rejected }
}

 return { classifyNaturalLanguage: classifyNaturalLanguage, partitionEditable: partitionEditable } })();
var classifyNaturalLanguage = __mforge_v2__dsh_plugin_client_classify_mjs.classifyNaturalLanguage;
var __mly_forge_v2__dsh_plugin_client_store_mjs = (function(){ 






const PREFIX = 'dsh-reply-forge-v2:'


function currentSessionId() {
  try {
    const path = window.location.pathname ?? ''
    const hit = /(?:^|\/)s(?:ession)?\/([A-Za-z0-9_-]+)/.exec(path)
    if (hit !== null && hit[1] !== undefined) return hit[1]
    const hash = window.location.hash ?? ''
    const hit2 = /(?:^|\/)s(?:ession)?\/([A-Za-z0-9_-]+)/.exec(hash)
    return hit2 !== null && hit2[1] !== undefined ? hit2[1] : '_global'
  } catch {
    return '_global'
  }
}


function fingerprint(text) {
  const norm = String(text ?? '').replace(/\s+/g, ' ').trim()
  const head = norm.slice(0, 80)
  const tail = norm.slice(-40)
  return head.length + ':' + head + '|' + tail
}

function keyOf(sessionId) {
  return PREFIX + String(sessionId ?? '_global')
}


function loadOverrides(sessionId) {
  try {
    const raw = window.localStorage.getItem(keyOf(sessionId))
    if (raw === null) return {}
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'object' && v !== null && typeof v.text === 'string') {
        out[k] = { text: v.text, at: typeof v.at === 'number' ? v.at : 0 }
      }
    }
    return out
  } catch {
    return {}
  }
}

function saveOverrides(sessionId, table) {
  try {
    window.localStorage.setItem(keyOf(sessionId), JSON.stringify(table))
    return true
  } catch {
    return false
  }
}


function setOverride(sessionId, fp, text) {
  const table = loadOverrides(sessionId)
  if (String(text ?? '') === '') delete table[fp]
  else table[fp] = { text: String(text), at: Date.now() }
  return saveOverrides(sessionId, table)
}

function removeOverride(sessionId, fp) {
  const table = loadOverrides(sessionId)
  if (!(fp in table)) return false
  delete table[fp]
  return saveOverrides(sessionId, table)
}


function clearOverrides(sessionId) {
  try {
    window.localStorage.removeItem(keyOf(sessionId))
    return true
  } catch {
    return false
  }
}


function loadPrefs() {
  const base = { enabled: true, autoMark: false }
  try {
    const raw = window.localStorage.getItem(PREFIX + 'prefs')
    if (raw === null) return base
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return base
    return {
      enabled: parsed.enabled !== false,
      autoMark: parsed.autoMark === true,
    }
  } catch {
    return base
  }
}

function savePrefs(prefs) {
  try {
    window.localStorage.setItem(PREFIX + 'prefs', JSON.stringify({
      enabled: prefs.enabled !== false,
      autoMark: prefs.autoMark === true,
    }))
  } catch {
    
  }
}

 return { currentSessionId: currentSessionId, fingerprint: fingerprint, loadOverrides: loadOverrides, setOverride: setOverride, removeOverride: removeOverride, clearOverrides: clearOverrides, loadPrefs: loadPrefs, savePrefs: savePrefs } })();
var currentSessionId = __mly_forge_v2__dsh_plugin_client_store_mjs.currentSessionId;
var fingerprint = __mly_forge_v2__dsh_plugin_client_store_mjs.fingerprint;
var loadOverrides = __mly_forge_v2__dsh_plugin_client_store_mjs.loadOverrides;
var setOverride = __mly_forge_v2__dsh_plugin_client_store_mjs.setOverride;
var removeOverride = __mly_forge_v2__dsh_plugin_client_store_mjs.removeOverride;
var clearOverrides = __mly_forge_v2__dsh_plugin_client_store_mjs.clearOverrides;
var loadPrefs = __mly_forge_v2__dsh_plugin_client_store_mjs.loadPrefs;
var savePrefs = __mly_forge_v2__dsh_plugin_client_store_mjs.savePrefs;
var __my_forge_v2__dsh_plugin_client_record_mjs = (function(){ 
















const ROUTE = '/api/reply-forge-v2/session/blocks'


const cache = new Map()


function normalizeText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim()
}







async function loadRecord(sessionId, options = {}) {
  const force = options.force === true
  if (force !== true) {
    const hit = cache.get(sessionId)
    if (hit !== undefined) return hit
  }
  const entry = { at: Date.now(), file: null, blocks: [], error: null }
  try {
    const res = await fetch(ROUTE + '?sessionId=' + encodeURIComponent(sessionId))
    const data = await res.json()
    if (data === null || typeof data !== 'object' || data.ok !== true) {
      entry.error = String((data && data.error) || ('HTTP ' + res.status))
    } else {
      entry.file = typeof data.file === 'string' ? data.file : null
      entry.blocks = Array.isArray(data.blocks) ? data.blocks : []
    }
  } catch (error) {
    entry.error = String((error && error.message) || error)
  }
  cache.set(sessionId, entry)
  return entry
}


function cachedRecord(sessionId) {
  return cache.get(sessionId) ?? null
}


function resetCache(sessionId) {
  if (sessionId === undefined) cache.clear()
  else cache.delete(sessionId)
}








function matchBlocks(diskBlocks, domTexts) {
  const out = domTexts.map(() => null)
  const used = new Set()
  const domNorm = domTexts.map(normalizeText)

  
  const byText = new Map()
  diskBlocks.forEach((b, i) => {
    const key = normalizeText(b.text)
    if (!byText.has(key)) byText.set(key, [])
    byText.get(key).push(i)
  })
  domNorm.forEach((key, di) => {
    if (key === '') return
    const list = byText.get(key)
    if (list === undefined) return
    
    while (list.length > 0 && used.has(list[0])) list.shift()
    if (list.length === 0) return
    const bi = list.shift()
    used.add(bi)
    out[di] = { ...diskBlocks[bi], exact: true }
  })

  
  
  
  
  const domLeft = []
  out.forEach((v, i) => { if (v === null) domLeft.push(i) })
  const diskLeft = diskBlocks.map((_, i) => i).filter(i => used.has(i) === false)
  const n = Math.min(domLeft.length, diskLeft.length)
  for (let k = 1; k <= n; k += 1) {
    const di = domLeft[domLeft.length - k]
    const bi = diskLeft[diskLeft.length - k]
    out[di] = { ...diskBlocks[bi], exact: false }
  }
  return out
}






async function forgeRecord(payload) {
  try {
    const res = await fetch('/api/reply-forge-v2/session/forge', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        
        
        'x-rf2-forge': '1',
      },
      body: JSON.stringify(payload),
    })
    const data = await res.json()
    if (data === null || typeof data !== 'object') return { ok: false, error: 'HTTP ' + res.status }
    return data
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
}

 return { normalizeText: normalizeText, loadRecord: loadRecord, cachedRecord: cachedRecord, resetCache: resetCache, matchBlocks: matchBlocks, forgeRecord: forgeRecord } })();
var loadRecord = __my_forge_v2__dsh_plugin_client_record_mjs.loadRecord;
var cachedRecord = __my_forge_v2__dsh_plugin_client_record_mjs.cachedRecord;
var resetCache = __my_forge_v2__dsh_plugin_client_record_mjs.resetCache;
var matchBlocks = __my_forge_v2__dsh_plugin_client_record_mjs.matchBlocks;
var normalizeText = __my_forge_v2__dsh_plugin_client_record_mjs.normalizeText;
var forgeRecord = __my_forge_v2__dsh_plugin_client_record_mjs.forgeRecord;
























const name = 'dsh-reply-forge-v2'


const inject = ['slots']

const SCAN_DEBOUNCE_MS = 220
const EDIT_ATTR = 'data-rf2-edited'


const OWN_UI_CLASSES = ['rf2-bar', 'rf2-editor', 'rf2-note', 'rf2-notes']


const taken = new WeakMap()


const dupCount = new WeakMap()


const blockMatch = new WeakMap()


let openEditor = null

function log(...args) {
  try { console.warn('[dsh-reply-forge-v2]', ...args) } catch {  }
}


function isOwnUi(el) {
  const cls = el.classList
  if (cls === undefined || cls === null) return false
  for (const name of OWN_UI_CLASSES) if (cls.contains(name)) return true
  return false
}










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


function closeEditor() {
  if (openEditor === null) return
  const { wrap } = openEditor
  openEditor = null
  try { wrap.remove() } catch {  }
}





function stripInjectedUI() {
  closeEditor()
  for (const el of [...document.querySelectorAll('[' + TAKEN_ATTR + ']')]) {
    el.removeAttribute(TAKEN_ATTR)
    el.removeAttribute(EDIT_ATTR)
    if (el.classList !== undefined && el.classList.contains('rf2-host')) el.classList.remove('rf2-host')
    for (const own of [...el.querySelectorAll('.rf2-bar, .rf2-editor, .rf2-note')]) own.remove()
  }
}


const originals = new Map()

function rememberOriginal(fp, text) {
  if (typeof fp !== 'string') return
  if (!originals.has(fp)) originals.set(fp, text)
}

function fpOriginal(block, fp) {
  return originals.get(fp) ?? ownText(block)
}


function makeNote(doc, kind, text) {
  const el = doc.createElement('div')
  el.className = 'rf2-note rf2-note-' + kind
  el.textContent = text
  return el
}









function applyOverride(block, text, prefs, docOverride) {
  block.textContent = ''
  renderMarkdown(block, text, docOverride ?? block.ownerDocument)
  if (prefs.autoMark === true) block.setAttribute(EDIT_ATTR, '')
  else block.removeAttribute(EDIT_ATTR)
}





function attachBar(block, doc, sessionId, prefs, match) {
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

  const fp = taken.get(block)
  const forgeBtn = makeButton(doc, '伪造回复', '就地编辑这条 AI 回复', () => openBlockEditor(block, sessionId, prefs, doc))
  if (match !== null && match !== undefined) forgeBtn.setAttribute('data-rf2-linked', '')
  bar.append(forgeBtn)

  const override = fp === undefined ? undefined : loadOverrides(sessionId)[fp]
  if (override !== undefined && typeof override.text === 'string') {
    bar.append(makeButton(doc, '还原', '删除本条本机覆盖', () => {
      removeOverride(sessionId, fp)
      block.removeAttribute(EDIT_ATTR)
      applyOverride(block, fpOriginal(block, fp), prefs, doc)
      attachBar(block, doc, sessionId, prefs, match)
    }, { 'data-active': true }))
  }
  return bar
}




function openBlockEditor(block, sessionId, prefs, docOverride) {
  closeEditor()
  const doc = docOverride ?? block.ownerDocument ?? document
  const match = blockMatch.get(block) ?? null

  
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

  
  
  
  const notes = doc.createElement('div')
  notes.className = 'rf2-notes'

  const head = [label, notes]

  
  
  const dup = dupCount.get(block) ?? 1
  if (dup > 1) {
    notes.append(makeNote(doc, 'warn',
      '⚠ 本会话有 ' + dup + ' 条正文完全相同的消息。本机渲染覆盖由它们共享；'
      + '写入会话记录只作用于当前这一条。'))
  }

  
  
  if (match === null) {
    notes.append(makeNote(doc, 'warn',
      '⚠ 未在会话记录中定位到这条回复，无法写入记录。'
      + '若刚发过消息或页面较旧，点「重新读取」后再试。'))
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
      attachBar(block, doc, sessionId, prefs, match)
    }
    closeEditor()
  }, { 'data-danger': true })

  const saveLocal = makeButton(doc, '仅本机渲染', '只改本页显示，模型看不见（Ctrl+Enter）', () => {
    const next = area.value
    const fp = taken.get(block) ?? fingerprint(original)
    setOverride(sessionId, fp, next)
    applyOverride(block, next, prefs, doc)
    attachBar(block, doc, sessionId, prefs, match)
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
        
        status.textContent = ''
        const stale = res.code === 'STALE_TARGET'
        notes.append(makeNote(doc, 'warn', '✖ ' + (res.error || '写入失败')
          + (stale ? '（记录里的正文已被改动，点「重新读取」后重试）' : '')))
        return
      }
      
      const fp = taken.get(block) ?? fingerprint(original)
      setOverride(sessionId, fp, next)
      
      applyOverride(block, next, prefs, doc)
      closeEditor()
      attachBar(block, doc, sessionId, prefs, match)
      
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
  try { area.focus() } catch {  }

  area.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.stopPropagation(); closeEditor(); return }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      event.stopPropagation()
      
      
      saveLocal.click()
    }
  })

  openEditor = { wrap, block }
}


function confirmWrite(newText) {
  const preview = String(newText).replace(/\s+/g, ' ').slice(0, 120)
  return window.confirm(
    '确认改写会话记录？\n\n'
    + '新正文：' + preview + (newText.length > 120 ? '…' : '') + '\n\n'
    + '· 会改动会话落盘文件，并自动备份（可还原）\n'
    + '· 写入后需要重启 DSH 才会对模型生效\n'
    + '· 写入后请勿在该会话继续对话，以免宿主的回写覆盖这次改动',
  )
}




function takeBlock(block, sessionId, overrides, prefs, docOverride, dup = 1, match = null) {
  if (block.hasAttribute(TAKEN_ATTR)) return
  
  
  const doc = docOverride ?? block.ownerDocument ?? document

  const original = ownText(block)
  const fp = fingerprint(original)
  rememberOriginal(fp, original)
  taken.set(block, fp)
  dupCount.set(block, dup)
  blockMatch.set(block, match)
  block.setAttribute(TAKEN_ATTR, '')

  
  
  
  block.classList.add('rf2-host')

  attachBar(block, doc, sessionId, prefs, match)
  const override = overrides[fp]
  if (override !== undefined && typeof override.text === 'string') {
    applyOverride(block, override.text, prefs, doc)
    attachBar(block, doc, sessionId, prefs, match)
  }
}


function scan(sessionId, prefs, docOverride) {
  
  if (prefs.enabled === false) return
  const doc = docOverride ?? document
  const root = conversationRoot(doc)
  if (root === null) return
  const overrides = loadOverrides(sessionId)
  
  const blocks = pickAssistantBlocks(root, classifyNaturalLanguage)

  
  const texts = blocks.map(ownText)
  const fps = new Map()
  const counts = new Map()
  for (const block of blocks) {
    const fp = fingerprint(ownText(block))
    fps.set(block, fp)
    counts.set(fp, (counts.get(fp) ?? 0) + 1)
  }

  
  
  const rec = cachedRecord(sessionId)
  const matches = (rec !== null && rec.error === null && rec.blocks.length > 0)
    ? matchBlocks(rec.blocks, texts)
    : blocks.map(() => null)

  blocks.forEach((block, i) => {
    try {
      takeBlock(block, sessionId, overrides, prefs, doc, counts.get(fps.get(block)) ?? 1, matches[i] ?? null)
    } catch (error) {
      log('接管消息块失败', error)
    }
  })
}





function apply(ctx) {
  
  if (document.querySelector('style[data-dsh-reply-forge-v2]') !== null) return

  const styleEl = document.createElement('style')
  styleEl.setAttribute('data-dsh-reply-forge-v2', '')
  styleEl.setAttribute('data-plugin', 'dsh-reply-forge-v2')
  styleEl.textContent = CSS
  document.head.append(styleEl)

  let prefs = loadPrefs()
  let sessionId = currentSessionId()

  
  let timer = null
  const scheduleScan = () => {
    if (timer !== null) return
    timer = window.setTimeout(() => {
      timer = null
      try { scan(sessionId, prefs, document) } catch (error) { log('扫描失败', error) }
    }, SCAN_DEBOUNCE_MS)
  }

  
  const syncRecord = () => {
    loadRecord(sessionId)
      .then(() => scheduleScan())
      .catch(error => log('读取会话记录失败', error))
  }

  
  const syncSession = () => {
    const next = currentSessionId()
    if (next === sessionId) return
    sessionId = next
    closeEditor()
    scheduleScan()
    syncRecord()
  }

  window.addEventListener('popstate', syncSession)
  window.addEventListener('hashchange', syncSession)

  
  
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
    
    
    scheduleScan()
  }

  
  const bootstrap = window.setInterval(() => {
    attachObserver()
    if (observedRoot !== null) {
      window.clearInterval(bootstrap)
      scheduleScan()
    }
  }, 600)
  attachObserver()
  syncRecord()

  
  const onKey = event => {
    if (event.altKey !== true || event.shiftKey !== true) return
    if (typeof event.key !== 'string' || event.key.toLowerCase() !== 'e') return
    const root = conversationRoot(document)
    
    
    const blocks = pickAssistantBlocks(root, classifyNaturalLanguage, { includeTaken: true })
    const last = blocks[blocks.length - 1]
    if (last === undefined) return
    event.preventDefault()
    openBlockEditor(last, sessionId, prefs, document)
  }
  window.addEventListener('keydown', onKey)

  ctx.effect(() => () => {
    window.clearInterval(bootstrap)
    if (timer !== null) window.clearTimeout(timer)
    if (observer !== null) observer.disconnect()
    window.removeEventListener('popstate', syncSession)
    window.removeEventListener('hashchange', syncSession)
    window.removeEventListener('keydown', onKey)
    stripInjectedUI()
    styleEl.remove()
  }, 'dsh-reply-forge-v2: teardown')

  
  try {
    window.__dshReplyForgeV2 = {
      version: '2.0.0',
      sessionId() { return sessionId },
      clearAll() {
        clearOverrides(sessionId)
        log('已清空当前会话的本机覆盖')
      },
      
      refresh() {
        resetCache(sessionId)
        return loadRecord(sessionId, { force: true }).then(rec => {
          scheduleScan()
          return { ok: rec.error === null, blocks: rec.blocks.length, error: rec.error }
        })
      },
      
      locate() {
        const root = conversationRoot(document)
        
        const blocks = pickAssistantBlocks(root, classifyNaturalLanguage, { includeTaken: true })
        const rec = cachedRecord(sessionId)
        if (rec === null) return { ok: false, error: '记录未加载' }
        if (rec.error !== null) return { ok: false, error: rec.error }
        const matches = matchBlocks(rec.blocks, blocks.map(ownText))
        return {
          ok: true,
          diskBlocks: rec.blocks.length,
          domBlocks: blocks.length,
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
        
        if (prefs.enabled) scheduleScan()
        else stripInjectedUI()
      },
    }
  } catch {
    
  }
}
module.exports.apply = apply;
module.exports.name = name;
module.exports.inject = inject;

		return module.exports;
	}
});
