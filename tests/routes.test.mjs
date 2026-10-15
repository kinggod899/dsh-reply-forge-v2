// host half 路由测试（tests/routes.test.mjs）。
//
// 直接调用路由 handler（不经真实 HTTP 服务器），但**读写都走真实文件系统**：
// 把 DSH_HOME 指到临时目录，放一份合成会话，验证「路由 → forgeSession →
// 落盘 → 读回」整条链，以及各种拒绝分支。这是 host half 唯一的对外接口，
// 参数校验漏一个，UI 或别的脚本就可能写坏会话。
//
// 运行：node tests/routes.test.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { registerRoutes } from '../.dsh-plugin/server/routes.mjs'
import { readSessionEvents } from '../src/session-log.mjs'

const READ_PATH = '/api/reply-forge-v2/session/blocks'
const WRITE_PATH = '/api/reply-forge-v2/session/forge'
const SESSION_ID = 'rftest-0001'
const TEXT_A = '这是第一条助手回复的正文，长度足够。'
const TEXT_B = '这是第二条助手回复的正文，长度足够。'

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

const tick = () => new Promise(resolve => setImmediate(resolve))

/** 把事件逐条压成独立帧（会话头一帧 + 每事件一帧）。 */
function sessionBytes(events) {
  const parts = [Buffer.from(JSON.stringify({ type: 'session', version: 4, id: SESSION_ID, createdAt: 1, cwd: 'E:\\文档' }) + '\n')]
  for (const ev of events) parts.push(Buffer.from(JSON.stringify(ev) + '\n'))
  return Buffer.concat(parts.map(p => zstdCompressSync(p)))
}

function assistantEvent(seq, text) {
  return {
    type: 'assistant/message',
    seq,
    time: 1700000000000 + seq,
    data: {
      turn: seq,
      step: 1,
      usage: { inputTokens: 10, cacheReadTokens: 100, cacheWriteTokens: 0, outputTokens: 5, totalTokens: 115 },
      message: { role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'p', model: 'm' }, id: 'msg-' + seq },
    },
  }
}

/** 建一个临时 DSH_HOME + 一个会话文件。 */
function makeHome() {
  const home = mkdtempSync(path.join(tmpdir(), 'rf-routes-'))
  const dir = path.join(home, 'sessions', '--proj--', 'session-' + SESSION_ID)
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'session.v4.jsonl.zstd')
  writeFileSync(file, sessionBytes([assistantEvent(1, TEXT_A), assistantEvent(2, TEXT_B)]))
  return { home, file, dir }
}

/** 收集注册的路由。 */
function mountRoutes() {
  const routes = {}
  registerRoutes({ register: r => { routes[r.path] = r } })
  return routes
}

/** 原生 req 桩：body 由测试显式 emit，便于控制时序。 */
function makeReq({ method = 'GET', url = '/', headers = {} } = {}) {
  const listeners = {}
  const req = {
    method,
    url,
    headers,
    on(type, fn) { (listeners[type] ??= []).push(fn); return req },
    destroy() {},
    emitBody(body) {
      const buf = Buffer.from(JSON.stringify(body))
      for (const fn of listeners.data ?? []) fn(buf)
      for (const fn of listeners.end ?? []) fn()
    },
  }
  return req
}

function makeRes() {
  const res = { statusCode: 0, headers: {}, body: null }
  res.setHeader = (k, v) => { res.headers[k] = v }
  res.end = s => { res.body = s }
  return res
}

const parse = res => JSON.parse(res.body)

/** 调一次读路由。 */
function callRead(routes, { method = 'GET', query = '?sessionId=' + SESSION_ID } = {}) {
  const res = makeRes()
  routes[READ_PATH].handler(makeReq({ method, url: READ_PATH + query }), res)
  return { status: res.statusCode, body: parse(res) }
}

/** 调一次写路由（body 会被同步 emit，promise 链需 await tick）。 */
async function callWrite(routes, { method = 'POST', headers = { 'x-rf2-forge': '1' }, body = {} } = {}) {
  const res = makeRes()
  const req = makeReq({ method, url: WRITE_PATH, headers })
  routes[WRITE_PATH].handler(req, res)
  req.emitBody(body)
  await tick()
  return { status: res.statusCode, body: parse(res) }
}

const originalHome = process.env.DSH_HOME

// ── 注册 ────────────────────────────────────────────────────────────────────

test('注册两条路由（读 + 写）', () => {
  const routes = mountRoutes()
  assert.ok(routes[READ_PATH] !== undefined, '必须有读路由')
  assert.ok(routes[WRITE_PATH] !== undefined, '必须有写路由')
  assert.equal(routes[READ_PATH].kind, 'exact')
  assert.equal(routes[WRITE_PATH].kind, 'exact')
})

// ── 读路由 ──────────────────────────────────────────────────────────────────

test('读路由：返回落盘正文块（seq + blockIndex + 原文）', () => {
  const { home } = makeHome()
  process.env.DSH_HOME = home
  const routes = mountRoutes()
  const r = callRead(routes)
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, true)
  assert.equal(r.body.total, 2, '应有两个正文块')
  assert.deepEqual(r.body.blocks.map(b => b.seq), [1, 2])
  assert.deepEqual(r.body.blocks.map(b => b.blockIndex), [0, 0])
  assert.deepEqual(r.body.blocks.map(b => b.text), [TEXT_A, TEXT_B])
  rmSync(home, { recursive: true, force: true })
})

test('读路由：缺 sessionId → 400', () => {
  const routes = mountRoutes()
  const r = callRead(routes, { query: '' })
  assert.equal(r.status, 400)
  assert.equal(r.body.ok, false)
})

test('读路由：会话不存在 → 404', () => {
  const { home } = makeHome()
  process.env.DSH_HOME = home
  const routes = mountRoutes()
  const r = callRead(routes, { query: '?sessionId=nope-not-here' })
  assert.equal(r.status, 404)
  rmSync(home, { recursive: true, force: true })
})

test('读路由：目录穿越被挡死 → 404', () => {
  const { home } = makeHome()
  process.env.DSH_HOME = home
  const routes = mountRoutes()
  const r = callRead(routes, { query: '?sessionId=' + encodeURIComponent('../../etc/passwd') })
  assert.equal(r.status, 404, 'sessionId 只允许安全字符，穿越必须落空')
  rmSync(home, { recursive: true, force: true })
})

test('读路由：非 GET → 405', () => {
  const routes = mountRoutes()
  const r = callRead(routes, { method: 'POST' })
  assert.equal(r.status, 405)
})

// ── 写路由：拒绝分支 ────────────────────────────────────────────────────────

test('写路由：缺自定义头 → 403', async () => {
  const { home, file } = makeHome()
  process.env.DSH_HOME = home
  const routes = mountRoutes()
  const before = readFileSync(file)
  const r = await callWrite(routes, { headers: {}, body: { sessionId: SESSION_ID, seq: 1, blockIndex: 0, newText: 'x' } })
  assert.equal(r.status, 403)
  assert.equal(Buffer.compare(before, readFileSync(file)), 0, '被拒时文件必须一字未动')
  rmSync(home, { recursive: true, force: true })
})

test('写路由：非 POST → 405', async () => {
  const routes = mountRoutes()
  const r = await callWrite(routes, { method: 'GET' })
  assert.equal(r.status, 405)
})

test('写路由：缺 sessionId / newText / seq → 400，且文件未动', async () => {
  const { home, file } = makeHome()
  process.env.DSH_HOME = home
  const routes = mountRoutes()
  const before = readFileSync(file)
  const cases = [
    [{ seq: 1, blockIndex: 0, newText: 'x' }, 'sessionId'],
    [{ sessionId: SESSION_ID, seq: 1, blockIndex: 0 }, 'newText'],
    [{ sessionId: SESSION_ID, newText: 'x' }, 'seq'],
  ]
  for (const [body, label] of cases) {
    const r = await callWrite(routes, { body })
    assert.equal(r.status, 400, label + ' 缺失应 400')
    assert.equal(r.body.ok, false)
  }
  assert.equal(Buffer.compare(before, readFileSync(file)), 0, '参数不全时文件必须一字未动')
  rmSync(home, { recursive: true, force: true })
})

test('写路由：newText 超长 → 413', async () => {
  const { home } = makeHome()
  process.env.DSH_HOME = home
  const routes = mountRoutes()
  const r = await callWrite(routes, { body: { sessionId: SESSION_ID, seq: 1, blockIndex: 0, newText: 'x'.repeat(512 * 1024 + 1) } })
  assert.equal(r.status, 413)
  rmSync(home, { recursive: true, force: true })
})

test('写路由：会话不存在 → 404', async () => {
  const { home } = makeHome()
  process.env.DSH_HOME = home
  const routes = mountRoutes()
  const r = await callWrite(routes, { body: { sessionId: 'nope-not-here', seq: 1, blockIndex: 0, newText: 'x' } })
  assert.equal(r.status, 404)
  rmSync(home, { recursive: true, force: true })
})

// ── 写路由：成功路径 ────────────────────────────────────────────────────────

test('写路由：正常写入 → 文件真被改、备份已生成、自读校验通过', async () => {
  const { home, file } = makeHome()
  process.env.DSH_HOME = home
  const routes = mountRoutes()
  const NEW = '这是被 v2 路由改写后的正文。'
  const r = await callWrite(routes, { body: { sessionId: SESSION_ID, seq: 1, blockIndex: 0, newText: NEW, expectText: TEXT_A } })
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, true, '应写入成功：' + JSON.stringify(r.body))
  assert.ok(typeof r.body.backup === 'string' && r.body.backup.includes('.bak-forge-'), '必须留下备份')
  assert.deepEqual(r.body.target, { seq: 1, blockIndex: 0 })

  // 读回：磁盘上确实是新正文，且另一条没被碰
  const blocks = readSessionEvents(file).filter(e => e.type === 'assistant/message')
    .flatMap(e => e.data.message.content.filter(b => b.type === 'text').map(b => b.text))
  assert.deepEqual(blocks, [NEW, TEXT_B], '只该改第一条')
  const backups = readdirSync(path.dirname(file)).filter(n => n.includes('.bak-forge-'))
  assert.equal(backups.length, 1, '应有一份备份')
  rmSync(home, { recursive: true, force: true })
})

test('写路由：expectText 不符 → 拒绝且文件一字未动', async () => {
  const { home, file } = makeHome()
  process.env.DSH_HOME = home
  const routes = mountRoutes()
  const before = readFileSync(file)
  const r = await callWrite(routes, { body: { sessionId: SESSION_ID, seq: 1, blockIndex: 0, newText: '不该写进去', expectText: '界面以为的旧正文（其实不对）' } })
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, false, '陈旧必须被拒')
  assert.equal(r.body.code, 'STALE_TARGET', '必须回 STALE_TARGET 让 UI 提示刷新，实际 ' + JSON.stringify(r.body))
  assert.equal(typeof r.body.actual, 'string', '要回带磁盘上的真实正文，供 UI 对照')
  assert.equal(Buffer.compare(before, readFileSync(file)), 0, '被拒时文件必须一字未动')
  rmSync(home, { recursive: true, force: true })
})

test('写路由：seq 不存在 → ok:false 且文件一字未动', async () => {
  const { home, file } = makeHome()
  process.env.DSH_HOME = home
  const routes = mountRoutes()
  const before = readFileSync(file)
  const r = await callWrite(routes, { body: { sessionId: SESSION_ID, seq: 9999, blockIndex: 0, newText: 'x' } })
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, false)
  assert.ok(String(r.body.error).includes('未命中'), '错误信息要说明没命中，实际：' + r.body.error)
  assert.equal(Buffer.compare(before, readFileSync(file)), 0)
  rmSync(home, { recursive: true, force: true })
})

test('写路由：blockIndex 越界 → ok:false 且文件一字未动', async () => {
  const { home, file } = makeHome()
  process.env.DSH_HOME = home
  const routes = mountRoutes()
  const before = readFileSync(file)
  const r = await callWrite(routes, { body: { sessionId: SESSION_ID, seq: 1, blockIndex: 7, newText: 'x' } })
  assert.equal(r.body.ok, false)
  assert.equal(Buffer.compare(before, readFileSync(file)), 0)
  rmSync(home, { recursive: true, force: true })
})

// 执行
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
if (originalHome === undefined) delete process.env.DSH_HOME
else process.env.DSH_HOME = originalHome
console.log(failed === 0 ? '\n全部通过（' + tests.length + '）' : '\n失败 ' + failed + ' / ' + tests.length)
process.exit(failed === 0 ? 0 : 1)
