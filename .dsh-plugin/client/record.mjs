// 会话落盘记录的浏览器侧访问层（v2 新增）。
//
// 为什么需要它：UI 只能看到**渲染后的 DOM 文本**，而落盘记录里是 markdown
// 源码，两者对不上（`**粗体**` 在页面上是「粗体」，`# 标题` 是「标题」）。
// 写入器用 sha256 指纹寻址，浏览器算不出同一个值——所以落盘定位改走
// 「事件 seq + 块索引」：这两个值由只读路由从磁盘原样带出来，与内容无关。
//
// 本模块的职责就是**把页面上看到的块，对上磁盘里的块**：
//   1. 精确匹配：规范化空白后全等（绝大多数纯自然语言回复都走这条）；
//   2. 末尾对齐兜底：宿主只渲染最近若干条时，磁盘块比 DOM 块多，
//      两边各取尾部按序一一对应，并标记为「推断」（exact: false）——
//      UI 必须把这个不确定性显式告诉用户，不能装作确定。
// 对不上的块返回 null，让编辑器禁用落盘出口，而不是猜一个位置去写。
//
// 零依赖、纯 ESM（构建契约：只能用相对导入，不得引入外部包）。

const ROUTE = '/api/reply-forge-v2/session/blocks'

/** 会话级缓存：sessionId → { at, file, blocks, error }。 */
const cache = new Map()

/** 规范化空白：与写入器指纹算法的第一步一致，但**不**做哈希。 */
export function normalizeText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * 拉取（或取缓存的）会话落盘正文块。
 * @param {string} sessionId
 * @param {{force?: boolean}} options force=true 时绕过缓存
 * @returns {Promise<{at:number,file:string|null,blocks:Array,error:string|null}>}
 */
export async function loadRecord(sessionId, options = {}) {
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

/** 取已缓存的记录（没拉过返回 null，不触发请求）。 */
export function cachedRecord(sessionId) {
  return cache.get(sessionId) ?? null
}

/** 丢弃缓存（不传 sessionId 清全部）。 */
export function resetCache(sessionId) {
  if (sessionId === undefined) cache.clear()
  else cache.delete(sessionId)
}

/**
 * 缓存里的记录是否「可能比页面旧」——需要重读的信号。
 *
 * 为什么需要这个判断：本模块的缓存只在三种时候失效——首次拉起、写入成功、
 * 用户点「重新读取」。而会话是**持续增长**的：宿主把新回复渲染进 DOM 之后
 * 还要约 200ms 才落盘（宿主 dsh-session-persistence-jsonl 的 enqueueLive
 * 用 setTimeout 批处理），本插件的缓存却不会自己更新。于是「伪造掉第一条
 * 回复之后，后面每一条新回复都拿着旧记录去比对，一律提示对不上」——
 * 2026-10-15 真机踩到的坑。
 *
 * 判据只有一条且是**单调**的：页面上的助手正文块比记录里多。正常会话里
 * 页面块数永远 ≤ 记录块数（历史可能被虚拟化折叠，记录反而更多），所以这个
 * 信号不会误报；反过来，页面比记录新只可能是记录过期（或宿主还没落盘）。
 *
 * @param {{blocks:Array,error:string|null}|null|null|undefined} entry cachedRecord 的返回值
 * @param {number} domBlockCount 页面上拾取到的助手正文块数
 * @returns {boolean} true = 该重读
 */
export function recordNeedsRefresh(entry, domBlockCount) {
  if (!(domBlockCount > 0)) return false
  if (entry === null || entry === undefined) return true
  if (entry.error !== null && entry.error !== undefined) return true
  return domBlockCount > entry.blocks.length
}

/**
 * 把 DOM 块与磁盘块配对。
 * @param {Array<{seq:number|null,blockIndex:number,text:string}>} diskBlocks 只读路由给的落盘块
 * @param {string[]} domTexts 页面上按顺序的块文本
 * @returns {Array<{seq:number|null,blockIndex:number,text:string,exact:boolean}|null>}
 *   与 domTexts 等长；对不上的位置是 null。
 */
export function matchBlocks(diskBlocks, domTexts) {
  const out = domTexts.map(() => null)
  const used = new Set()
  const domNorm = domTexts.map(normalizeText)

  // ── 1) 精确匹配：规范化后全等。同名多条按出现顺序一一对应。 ──────────────
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
    // 跳过已被前面同文本块占用掉的候选。
    while (list.length > 0 && used.has(list[0])) list.shift()
    if (list.length === 0) return
    const bi = list.shift()
    used.add(bi)
    out[di] = { ...diskBlocks[bi], exact: true }
  })

  // ── 2) 末尾对齐兜底 ────────────────────────────────────────────────────
  // 页面上往往只有最近若干条（历史被虚拟化/折叠），磁盘块更多。
  // 两侧各取未配对的尾部，按顺序一一对应。这是**推断**，不是事实，
  // 所以 exact: false，UI 要如实标注。
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

/**
 * 执行落盘改写（POST 到 host half）。
 * @param {{sessionId:string,seq:number,blockIndex:number,newText:string,expectText:string}} payload
 * @returns {Promise<{ok:boolean,backup?:string,verify?:object,stripped?:number,error?:string,code?:string,actual?:string}>}
 */
export async function forgeRecord(payload) {
  try {
    const res = await fetch('/api/reply-forge-v2/session/forge', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // 自定义头：挡住「同源下别的脚本顺手 POST 一下」这种误触。
        // host half 会校验它，缺了直接 403。
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
