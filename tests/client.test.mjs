// 客户端 half 回归测试（tests/client.test.mjs）。
//
// 在 DOM 桩里跑通构建产物 .dsh-plugin/client.js 的完整链路。为什么测产物而不是
// 源码：宿主加载的就是这个文件，构建器（自研内联器）本身也会出错，测源码会漏掉。
//
// 覆盖两类：
//   A. 承自 v1 的渲染层回归（接管、幂等、自愈、分类器、重名警示）——v2 只改了
//      前缀，这些行为一个都不该退化；
//   B. v2 新增的落盘链路（定位成功/失败、POST 载荷、陈旧拒绝、双出口分离）。
//
// 运行：node tests/client.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createDocument, createWindow, mk } from './dom-stub.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const CODE = readFileSync(resolve(ROOT, '.dsh-plugin', 'client.js'), 'utf8')
const PACKAGE_NAME = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).name

const DEFAULT_TEXT = '这是 AI 原本输出的回复内容，长度足够触发识别阈值并且要超过最小值。'

/** 收集式 MutationObserver 桩：测试可手动 fire() 模拟宿主 DOM 变更。 */
const observers = []
class ObserverStub {
  constructor(cb) { this.cb = cb; observers.push(this) }
  observe() {}
  disconnect() {}
  fire() { this.cb() }
}

/** 加载插件模块（走官方 __ModuleLoader__.load 契约）。 */
function loadPlugin(doc, win, fetchImpl) {
  const mods = {}
  const loader = { load: ({ id, factory }) => { mods[id] = factory(() => { throw new Error('no require') }) } }
  win.__ModuleLoader__ = loader
  const runner = new Function('window', 'document', 'MutationObserver', 'console', 'fetch', CODE)
  runner(
    win,
    doc,
    ObserverStub,
    { warn: () => {}, log: () => {}, error: () => {} },
    fetchImpl,
  )
  assert.ok(mods[PACKAGE_NAME], '加载器工厂 id 必须等于 package.json 的 name：' + PACKAGE_NAME + '；实际 ' + Object.keys(mods).join(','))
  return mods[PACKAGE_NAME]
}

/** 触发全部 Observer 回调 + 冲刷定时器（模拟宿主 DOM 变更后的扫描）。 */
function fireMutations(flush) {
  for (const o of observers) o.fire()
  flush()
}

/** 让挂起的 promise 链跑完（loadRecord → then → scheduleScan）。 */
const tick = () => new Promise(resolve => setImmediate(resolve))

/** fetch 桩：按 URL 分流到「读记录」与「写记录」。 */
function makeFetch({ blocks = [], forgeResult = null, readError = null } = {}) {
  const calls = []
  const fetchImpl = (url, init = {}) => {
    const u = String(url)
    calls.push({ url: u, init })
    if (u.includes('/session/blocks')) {
      // readError 模拟「会话文件找不到」这类读失败（路由回 ok:false）。
      if (readError !== null) {
        return Promise.resolve({ status: 404, json: () => Promise.resolve({ ok: false, error: readError }) })
      }
      return Promise.resolve({
        status: 200,
        json: () => Promise.resolve({ ok: true, sessionId: 'test-session', file: '/tmp/x', total: blocks.length, blocks }),
      })
    }
    if (u.includes('/session/forge')) {
      const payload = forgeResult ?? { ok: true, backup: '/tmp/x.bak-forge-1', verify: { events: 3, blocks: 1 }, stripped: 0 }
      return Promise.resolve({ status: 200, json: () => Promise.resolve(payload) })
    }
    return Promise.resolve({ status: 404, json: () => Promise.resolve({ ok: false, error: 'not found' }) })
  }
  return { calls, fetchImpl }
}

/**
 * 搭一条会话：main.conversation 锚点 + N 个助手消息块 + fetch 桩。
 * 默认让磁盘记录与页面文本完全一致（精确匹配路径）。
 *
 * sessionAttr 是宿主渲染在会话容器上的当前会话 id
 * （`data-conversation-session`）——dsh 的 URL 里没有会话 id，这是唯一来源。
 * 传 null 模拟「容器还没挂载 / 属性缺失」。
 */
function setup({
  texts = [DEFAULT_TEXT], blocks = null, forgeResult = null, confirmResult = true,
  sessionAttr = 'test-session', pathname = '/s/test-session', readError = null,
} = {}) {
  const doc = createDocument()
  const storage = {}
  const { window: win, pending, flush, confirmCalls, dispatch } = createWindow({ storage, confirmResult, pathname })
  const conv = mk('div')
  conv.setAttribute('data-slot', 'main.conversation')
  if (sessionAttr !== null) conv.setAttribute('data-conversation-session', sessionAttr)
  const msgs = texts.map(t => {
    const m = mk('div', 'Kwoi6G_body')
    m.append(mk('p', '', t))
    conv.append(m)
    return m
  })
  doc.body.append(conv)
  const diskBlocks = blocks === null
    ? texts.map((t, i) => ({ seq: 100 + i * 10, blockIndex: 1, text: t }))
    : blocks
  const { calls, fetchImpl } = makeFetch({ blocks: diskBlocks, forgeResult, readError })
  return { doc, win, pending, flush, conv, msgs, msg: msgs[0], storage, calls, fetchImpl, confirmCalls, dispatch }
}

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

/** 打开第 i 个块（默认第 0 个）的编辑器。 */
function openEditor(msg) {
  const bar = msg.children.find(c => c.classList.contains('rf2-bar'))
  assert.ok(bar !== undefined, '必须有操作条')
  bar.children[0].click()
  const editor = msg.children.find(c => c.classList.contains('rf2-editor'))
  assert.ok(editor !== undefined, '必须打开编辑器')
  return editor
}

const btn = (editor, label) => editor.querySelectorAll('button').find(b => b.textContent === label)

// ── A. 渲染层回归 ───────────────────────────────────────────────────────────

test('apply 注入样式并接管助手消息', async () => {
  const { doc, win, flush, msg, fetchImpl } = setup()
  const mod = loadPlugin(doc, win, fetchImpl)
  assert.equal(typeof mod.apply, 'function', 'apply 必须导出')
  assert.deepEqual(mod.inject, ['slots'])
  mod.apply({ effect: () => {} })
  assert.ok(doc.querySelector('style[data-dsh-reply-forge-v2]') !== null, '样式必须注入')
  await tick(); flush()
  assert.ok(msg.hasAttribute('data-rf2-taken'), '消息块必须被接管')
  assert.ok(msg.classList.contains('rf2-host'), '需补定位上下文')
})

test('仅本机渲染 → 覆盖落库（v2 前缀）且渲染生效', async () => {
  const { doc, win, flush, msg, storage, fetchImpl, calls } = setup()
  const mod = loadPlugin(doc, win, fetchImpl)
  mod.apply({ effect: () => {} })
  await tick(); flush()
  const editor = openEditor(msg)
  assert.ok(editor.querySelector('textarea').value.length > 0, '编辑器需预填原文')
  editor.querySelector('textarea').value = '# 伪造标题\n\n这是 **伪造** 的内容。'
  btn(editor, '仅本机渲染').click()
  assert.ok(msg.textContent.includes('伪造标题'), '覆盖必须渲染出来')
  assert.equal(editor.parentElement, null, '保存后编辑器必须关闭')
  const keys = Object.keys(storage)
  assert.ok(keys.some(k => k.startsWith('dsh-reply-forge-v2:')), '覆盖必须落 v2 前缀的库，实际 ' + JSON.stringify(keys))
  assert.equal(keys.some(k => k.startsWith('dsh-reply-forge:v1:')), false, '绝不能写 v1 的键')
  assert.equal(calls.some(c => c.url.includes('/session/forge')), false, '仅本机渲染不得触发落盘写入')
})

test('重复扫描幂等：不重复挂操作条', async () => {
  const { doc, win, flush, msg, fetchImpl } = setup()
  const mod = loadPlugin(doc, win, fetchImpl)
  mod.apply({ effect: () => {} })
  await tick(); flush(); flush(); flush()
  const bars = msg.children.filter(c => c.classList.contains('rf2-bar'))
  assert.equal(bars.length, 1, '操作条只能有一个，实际 ' + bars.length)
})

test('真实 UI 结构：chat.node 槽位精确接管正文、排除思考/用户/系统/滚动壳', async () => {
  const doc = createDocument()
  const { window: win, flush } = createWindow()
  const { fetchImpl } = makeFetch()
  const conv = mk('div')
  conv.setAttribute('data-slot', 'main.conversation')

  const scrollBody = mk('div', 'wSkVaW_body')
  conv.append(scrollBody)

  const sysNode = mk('div')
  sysNode.setAttribute('data-slot', 'conversation.chat.node')
  const sysRow = mk('div', 'XrJvXW_root')
  sysRow.append(mk('span', '_title_luwio_79', '系统提示词'))
  sysRow.append(mk('span', 'XrJvXW_source', '@deepseek-ai/dsh-system-prompt'))
  sysNode.append(sysRow)
  scrollBody.append(sysNode)

  const userNode = mk('div')
  userNode.setAttribute('data-slot', 'conversation.chat.node')
  const userRow = mk('div', 'Sixlwa_userRow')
  const bubble = mk('div', 'Sixlwa_bubble')
  bubble.append(mk('span', '_plainRun_z12h9_6', '你好'))
  userRow.append(bubble)
  userNode.append(userRow)
  scrollBody.append(userNode)

  const aiNode = mk('div')
  aiNode.setAttribute('data-slot', 'conversation.chat.node')
  const aiBody = mk('div', 'hWmORq_body')
  const thinkWrap = mk('div')
  const think = mk('div', 'lcKema_root')
  const thinkRow = mk('div', '_row_luwio_16')
  thinkRow.append(mk('span', 'lcKema_leading', ''))
  thinkRow.append(mk('span', 'lcKema_label', '思考'))
  think.append(thinkRow)
  thinkWrap.append(think)
  const md = mk('div', '_markdown_kcgor_5')
  md.append(mk('p', '', '你好！我是助手，这是给你的回复正文，长度肯定够。'))
  md.append(mk('ul', '', '要点一要点二要点三'))
  aiBody.append(thinkWrap, md)
  aiNode.append(aiBody)
  scrollBody.append(aiNode)

  doc.body.append(conv)
  const mod = loadPlugin(doc, win, fetchImpl)
  mod.apply({ effect: () => {} })
  await tick(); flush()

  assert.ok(md.hasAttribute('data-rf2-taken'), 'markdown 正文容器必须被接管')
  assert.ok(!think.hasAttribute('data-rf2-taken'), '思考块不能被接管')
  assert.ok(!bubble.hasAttribute('data-rf2-taken'), '用户气泡不能被接管')
  assert.ok(!sysRow.hasAttribute('data-rf2-taken'), '系统/上下文节点不能被接管')
  assert.ok(!scrollBody.hasAttribute('data-rf2-taken'), '巨型滚动容器不能被接管')
  assert.equal(doc.querySelectorAll('.rf2-bar').length, 1, '只能挂一个操作条')
})

test('分类器：工具调用块不接管，短回复与含代码正文接管', async () => {
  const doc = createDocument()
  const { window: win, flush } = createWindow()
  const { fetchImpl } = makeFetch()
  const conv = mk('div')
  conv.setAttribute('data-slot', 'main.conversation')

  const natural = mk('div', 'Kwoi6G_body')
  natural.append(mk('p', '', '这是一段纯粹的自然语言回复，用来说明某个问题的成因与解决办法，长度足够。'))
  const tool = mk('div', 'Kwoi6G_body')
  tool.append(mk('p', '', '调用工具 读取文件 C:\\Users\\test\\a.txt 完成后返回结果，长度也足够长。'))
  const code = mk('div', 'Kwoi6G_body')
  code.append(mk('pre', '', 'npm install'), mk('p', '', '上面是执行的命令内容，长度足够触发识别阈值。'))
  const english = mk('div', 'Kwoi6G_body')
  english.append(mk('p', '', 'The difference between the two approaches is difficult to see; a patched version needs another patch discussion.'))
  const short = mk('div', 'Kwoi6G_body')
  short.append(mk('p', '', '嗯，还醒着。要测什么，直接说。'))

  conv.append(natural, tool, code, english, short)
  doc.body.append(conv)
  const mod = loadPlugin(doc, win, fetchImpl)
  mod.apply({ effect: () => {} })
  await tick(); flush()

  assert.ok(natural.hasAttribute('data-rf2-taken'), '纯自然语言块必须接管')
  assert.equal(tool.hasAttribute('data-rf2-taken'), false, '工具调用块不得接管')
  assert.ok(code.hasAttribute('data-rf2-taken'), '含代码块的正文必须接管')
  assert.ok(english.hasAttribute('data-rf2-taken'), 'diff/patch 子串不得误伤英文散文')
  assert.ok(short.hasAttribute('data-rf2-taken'), '短回复必须接管')
})

test('宿主重渲染抹掉操作条后自愈重接管', async () => {
  const { doc, win, flush, msg, fetchImpl } = setup()
  const mod = loadPlugin(doc, win, fetchImpl)
  mod.apply({ effect: () => {} })
  await tick(); flush()
  assert.equal(msg.querySelectorAll('.rf2-bar').length, 1, '首轮一条操作条')
  msg.children.length = 0
  msg.append(mk('p', '', '这是宿主重渲染后的全新正文内容，长度足够通过所有识别阈值。'))
  fireMutations(flush)
  assert.equal(msg.querySelectorAll('.rf2-bar').length, 1, '操作条必须被重新挂上（自愈）')
  assert.ok(msg.hasAttribute('data-rf2-taken'), '自愈后接管标记必须还在')
})

test('覆盖在重载后自动重新应用（自愈）', async () => {
  const { doc, win, flush, msg, storage, fetchImpl } = setup()
  const mod = loadPlugin(doc, win, fetchImpl)
  mod.apply({ effect: () => {} })
  await tick(); flush()
  const editor = openEditor(msg)
  editor.querySelector('textarea').value = '持久化后的伪造内容'
  btn(editor, '仅本机渲染').click()

  const store = { ...storage }
  const doc2 = createDocument()
  const { window: win2, flush: flush2 } = createWindow({ storage: store })
  const { fetchImpl: fetch2 } = makeFetch()
  const conv2 = mk('div')
  conv2.setAttribute('data-slot', 'main.conversation')
  const msg2 = mk('div', 'Kwoi6G_body')
  msg2.append(mk('p', '', DEFAULT_TEXT))
  conv2.append(msg2)
  doc2.body.append(conv2)
  const mod2 = loadPlugin(doc2, win2, fetch2)
  mod2.apply({ effect: () => {} })
  await tick(); flush2()
  assert.ok(msg2.textContent.includes('持久化后的伪造内容'), '刷新后覆盖必须自动恢复')
})

test('偏好 enabled=false 时不接管，setEnabled 实时开/关', async () => {
  const { doc, win, flush, msg, fetchImpl } = setup()
  win.localStorage.setItem('dsh-reply-forge-v2:prefs', JSON.stringify({ enabled: false }))
  const mod = loadPlugin(doc, win, fetchImpl)
  mod.apply({ effect: () => {} })
  await tick(); flush()
  assert.equal(msg.hasAttribute('data-rf2-taken'), false, '停用状态下不得接管')
  assert.equal(typeof win.__dshReplyForgeV2?.setEnabled, 'function', '调试命名空间必须暴露 setEnabled')

  win.__dshReplyForgeV2.setEnabled(true)
  flush()
  assert.ok(msg.hasAttribute('data-rf2-taken'), 'setEnabled(true) 后必须恢复接管')
  win.__dshReplyForgeV2.setEnabled(false)
  assert.equal(msg.querySelector('.rf2-bar'), null, 'setEnabled(false) 后操作条必须拆除')
})

test('指纹重名：编辑器给共享覆盖警示，并说明落盘出口不受影响', async () => {
  const dup = '这是两条一模一样的回复正文，用来验证指纹重名时的共享覆盖逻辑与编辑器警示，长度足够触发阈值。'
  const { doc, win, flush, msgs, fetchImpl } = setup({ texts: [dup, dup] })
  const mod = loadPlugin(doc, win, fetchImpl)
  mod.apply({ effect: () => {} })
  await tick(); flush()
  assert.ok(msgs[0].hasAttribute('data-rf2-taken') && msgs[1].hasAttribute('data-rf2-taken'), '两条都必须接管')
  const editor = openEditor(msgs[0])
  const warn = editor.querySelector('.rf2-note-warn')
  assert.ok(warn !== null, '重名时必须出现警示')
  assert.ok(warn.textContent.includes('2'), '警示需说明重名条数')
  assert.ok(warn.textContent.includes('写入会话记录只作用于当前这一条'), '必须讲清两个出口的差别')
})

// ── B. 落盘链路 ─────────────────────────────────────────────────────────────

test('定位成功 → 按钮带记号、编辑器显示已定位、落盘出口可用', async () => {
  const { doc, win, flush, msg, fetchImpl } = setup()
  const mod = loadPlugin(doc, win, fetchImpl)
  mod.apply({ effect: () => {} })
  await tick(); flush()
  const bar = msg.children.find(c => c.classList.contains('rf2-bar'))
  assert.ok(bar.children[0].hasAttribute('data-rf2-linked'), '已定位的块，操作条按钮要带记号')
  const editor = openEditor(msg)
  const ok = editor.querySelector('.rf2-note-ok')
  assert.ok(ok !== null, '必须显示已定位')
  assert.ok(ok.textContent.includes('seq=100'), '定位状态要带出 seq，实际：' + ok.textContent)
  assert.equal(Boolean(btn(editor, '写入会话记录').disabled), false, '定位到了就该能写')
})

test('定位失败（记录为空）→ 显示警示且落盘出口禁用', async () => {
  const { doc, win, flush, msg, fetchImpl } = setup({ blocks: [] })
  const mod = loadPlugin(doc, win, fetchImpl)
  mod.apply({ effect: () => {} })
  await tick(); flush()
  const editor = openEditor(msg)
  const warn = editor.querySelector('.rf2-note-warn')
  assert.ok(warn !== null, '必须给出未定位警示')
  assert.ok(warn.textContent.includes('没有可定位的助手正文'), '实际：' + warn.textContent)
  assert.equal(btn(editor, '写入会话记录').disabled, true, '定位不到就不许写——宁可少个按钮，也不能猜位置')
})

test('记录里有正文但这条对不上 → 提示要区分于「记录是空的」', async () => {
  // 磁盘上只有一段不相干的内容。页面两条、磁盘一条 → 末尾对齐兜底只能
  // 配上最后一条，第一条仍然对不上（这正是兜底的设计意图）。
  const { doc, win, flush, conv, fetchImpl } = setup({
    texts: [
      '页面上这条完全不在磁盘记录里，长度也够触发识别阈值。',
      '页面上第二同样不在磁盘记录里，长度也够触发识别阈值。',
    ],
    blocks: [{ seq: 1, blockIndex: 0, text: '磁盘上是完全另一段内容，跟页面这两条没有任何关系。' }],
  })
  const mod = loadPlugin(doc, win, fetchImpl)
  mod.apply({ effect: () => {} })
  await tick(); flush()
  const editor = openEditor(conv.children[0])
  const warn = editor.querySelector('.rf2-note-warn')
  assert.ok(warn.textContent.includes('未在会话记录中定位到'), '实际：' + warn.textContent)
  assert.ok(warn.textContent.includes('记录里有 1 条正文'), '要报出记录规模，便于判断是「没读到」还是「对不上」')
  assert.equal(btn(editor, '写入会话记录').disabled, true)
})

test('记录读取失败 → 落盘出口禁用，且把真实错误显示出来', async () => {
  const { doc, win, flush, msg, fetchImpl } = setup({ readError: 'session log not found' })
  const mod = loadPlugin(doc, win, fetchImpl)
  mod.apply({ effect: () => {} })
  await tick(); flush()
  const editor = openEditor(msg)
  assert.equal(btn(editor, '写入会话记录').disabled, true)
  const warn = editor.querySelector('.rf2-note-warn')
  // 关键：不能把「读失败」和「对不上」混成同一句话——排查时会变成猜谜。
  assert.ok(warn.textContent.includes('读取会话记录失败'), '实际：' + warn.textContent)
  assert.ok(warn.textContent.includes('session log not found'), '必须带上真实错误原因')
})

test('会话 id 取自 DOM 的 data-conversation-session（dsh 的 URL 里没有会话 id）', async () => {
  // URL 里故意不含任何会话段，只有 DOM 属性有真值
  const { doc, win, flush, fetchImpl, calls } = setup({ sessionAttr: 'session-dom-abc123', pathname: '/' })
  const mod = loadPlugin(doc, win, fetchImpl)
  mod.apply({ effect: () => {} })
  await tick(); flush()
  const read = calls.find(c => c.url.includes('/session/blocks'))
  assert.ok(read !== undefined, '必须发起读记录请求')
  assert.ok(read.url.includes('session-dom-abc123'), '必须用 DOM 上的会话 id；实际 URL：' + read.url)
})

test('容器未挂载时用占位值不发请求，DOM 出现后自动升级为真实会话 id', async () => {
  // 首屏：会话容器还没有 data-conversation-session
  const { doc, win, flush, conv, fetchImpl, calls } = setup({ sessionAttr: null, pathname: '/' })
  const mod = loadPlugin(doc, win, fetchImpl)
  mod.apply({ effect: () => {} })
  await tick(); flush()
  assert.equal(calls.filter(c => c.url.includes('/session/blocks')).length, 0,
    '会话未知时不该发必然 404 的请求')

  // 宿主把会话容器挂出来，带上真实 id
  conv.setAttribute('data-conversation-session', 'session-late-777')
  fireMutations(flush)
  await tick(); flush()

  const read = calls.find(c => c.url.includes('/session/blocks'))
  assert.ok(read !== undefined, '识别出会话后必须补拉记录')
  assert.ok(read.url.includes('session-late-777'), '必须用新识别出的 id；实际：' + read.url)
  // 定位成功后落盘出口应当可用
  const editor = openEditor(conv.children[0])
  assert.equal(Boolean(btn(editor, '写入会话记录').disabled), false, '定位成功就该允许写入')
})

test('写入会话记录 → POST 载荷正确（seq/blockIndex/expectText/自定义头）且二次确认', async () => {
  const { doc, win, flush, msg, fetchImpl, calls, storage, confirmCalls } = setup()
  const mod = loadPlugin(doc, win, fetchImpl)
  mod.apply({ effect: () => {} })
  await tick(); flush()
  const editor = openEditor(msg)
  editor.querySelector('textarea').value = '改写后的正文'
  btn(editor, '写入会话记录').click()
  await tick(); flush()

  assert.equal(confirmCalls.length, 1, '落盘是不可逆操作，必须二次确认')
  assert.ok(confirmCalls[0].includes('重启 DSH'), '确认文案必须讲明需要重启')
  // 用户实测反馈：只写「别继续对话」会让人以为「重启后也不能聊了」。
  // 文案必须把两件事分开说清——重启前别聊（宿主内存是旧的）+ 重启后可以正常聊。
  assert.ok(confirmCalls[0].includes('重启前'), '确认文案必须点明限制只作用于「重启前」')
  assert.ok(confirmCalls[0].includes('重启之后就可以正常继续聊'), '必须明确给出「重启后可以继续聊」的结论')
  const post = calls.find(c => c.url.includes('/session/forge'))
  assert.ok(post !== undefined, '必须发出落盘请求')
  assert.equal(post.init.method, 'POST')
  assert.equal(post.init.headers['x-rf2-forge'], '1', '必须带自定义头（挡住同源误触）')
  const body = JSON.parse(post.init.body)
  assert.equal(body.sessionId, 'test-session')
  assert.equal(body.seq, 100, 'seq 必须来自磁盘记录')
  assert.equal(body.blockIndex, 1)
  assert.equal(body.expectText, DEFAULT_TEXT, '必须回传 UI 看到的那份原文做陈旧校验')
  assert.equal(body.newText, '改写后的正文')
  // 成功后同步一份本机覆盖：界面立刻看到，且与记录一致
  assert.ok(msg.textContent.includes('改写后的正文'), '写入成功后页面要立刻显示新内容')
  assert.ok(Object.keys(storage).some(k => k.startsWith('dsh-reply-forge-v2:')), '同时写本机覆盖')
  assert.ok(msg.textContent.includes('重启 DSH 后模型生效'), '必须提示重启生效')
})

test('用户取消二次确认 → 不发请求', async () => {
  const { doc, win, flush, msg, fetchImpl, calls, confirmCalls } = setup({ confirmResult: false })
  const mod = loadPlugin(doc, win, fetchImpl)
  mod.apply({ effect: () => {} })
  await tick(); flush()
  const editor = openEditor(msg)
  editor.querySelector('textarea').value = '不该被写进去的正文'
  btn(editor, '写入会话记录').click()
  await tick(); flush()
  assert.equal(confirmCalls.length, 1, '确认框要弹')
  assert.equal(calls.some(c => c.url.includes('/session/forge')), false, '取消后绝不能发请求')
})

test('陈旧拒绝（STALE_TARGET）→ 提示重新读取', async () => {
  const stale = { ok: false, error: '磁盘上的正文与预期不一致（界面看到的内容已过期），已拒绝写入。请刷新后重试。', code: 'STALE_TARGET', actual: '磁盘上其实是别的内容' }
  const { doc, win, flush, msg, fetchImpl } = setup({ forgeResult: stale })
  const mod = loadPlugin(doc, win, fetchImpl)
  mod.apply({ effect: () => {} })
  await tick(); flush()
  const editor = openEditor(msg)
  editor.querySelector('textarea').value = '新的正文'
  btn(editor, '写入会话记录').click()
  await tick(); flush()
  const notes = editor.querySelectorAll('.rf2-note-warn')
  const hit = notes.find(n => n.textContent.includes('已过期') || n.textContent.includes('重新读取'))
  assert.ok(hit !== undefined, '陈旧拒绝必须给出可操作提示，实际：' + JSON.stringify(notes.map(n => n.textContent)))
})

test('内容没变化时不发请求', async () => {
  const { doc, win, flush, msg, fetchImpl, calls, confirmCalls } = setup()
  const mod = loadPlugin(doc, win, fetchImpl)
  mod.apply({ effect: () => {} })
  await tick(); flush()
  const editor = openEditor(msg)
  // 原样不改，直接点写入
  btn(editor, '写入会话记录').click()
  await tick(); flush()
  assert.equal(confirmCalls.length, 0, '没变化不该弹确认')
  assert.equal(calls.some(c => c.url.includes('/session/forge')), false, '没变化不该发请求')
})

test('快捷键 Alt+Shift+E：全部块已接管后仍能打开最后一条的编辑器', async () => {
  // 回归：picker 的幂等守卫会跳过「已接管」的块，于是「所有块都接管完之后
  // 按快捷键毫无反应」。枚举用途必须带 includeTaken 才拿得到块。
  const { doc, win, flush, msgs, dispatch, fetchImpl } = setup({ texts: ['第一条回复正文，长度足够触发阈值。', '第二条回复正文，长度足够触发阈值。'] })
  const mod = loadPlugin(doc, win, fetchImpl)
  mod.apply({ effect: () => {} })
  await tick(); flush()
  assert.ok(msgs[0].hasAttribute('data-rf2-taken') && msgs[1].hasAttribute('data-rf2-taken'), '两条都该被接管')
  assert.equal(doc.querySelectorAll('.rf2-editor').length, 0, '此刻不该有编辑器')
  dispatch('keydown', { altKey: true, shiftKey: true, key: 'e' })
  assert.equal(doc.querySelectorAll('.rf2-editor').length, 1, '快捷键必须能打开编辑器')
  const editor = msgs[1].children.find(c => c.classList.contains('rf2-editor'))
  assert.ok(editor !== undefined, '必须开在最后一条上')
  assert.ok(editor.querySelector('textarea').value.includes('第二条'), '编辑框要预填该条正文（不含按钮文字）')
})

test('调试命名空间 locate() 能报出定位情况', async () => {
  const { doc, win, flush, fetchImpl } = setup()
  const mod = loadPlugin(doc, win, fetchImpl)
  mod.apply({ effect: () => {} })
  await tick(); flush()
  const info = win.__dshReplyForgeV2.locate()
  assert.equal(info.ok, true)
  assert.equal(info.diskBlocks, 1)
  assert.equal(info.domBlocks, 1)
  assert.equal(info.matched, 1)
  assert.equal(info.exact, 1)
})

// 执行（异步：落盘链路要走 promise）
let failed = 0
for (const t of tests) {
  try {
    await t.fn()
    console.log('  PASS  ' + t.name)
  } catch (error) {
    failed += 1
    console.log('  FAIL  ' + t.name)
    console.log('        ' + String(error?.message ?? error).split('\n')[0])
  }
}
console.log(failed === 0 ? '\n全部通过（' + tests.length + '）' : '\n失败 ' + failed + ' / ' + tests.length)
process.exit(failed === 0 ? 0 : 1)
