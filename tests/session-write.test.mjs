// 落盘写入器测试（tests/session-write.test.mjs）。
// 合成多帧 zstd JSONL fixture 在临时目录跑，不碰真实会话。
// 运行：node tests/session-write.test.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import {
  forgeSession, loadLines, locateTargets, fingerprint, assistantTextBlockRefs,
} from '../src/session-write.mjs'
import { readSessionEvents, scanZstdFrames } from '../src/session-log.mjs'

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

/** 造一个三帧会话：帧0 初始化 / 帧1 一轮对话（含带签名 thinking）/ 帧2 工具结果+第二条回复 */
function makeSession(dir) {
  const ev = o => JSON.stringify(o)
  const frame0 = [
    ev({ seq: 0, type: 'session', data: { id: 's1' } }),
  ].join('\n') + '\n'
  const frame1 = [
    ev({ seq: 1, type: 'turn/start', data: {} }),
    ev({ seq: 2, type: 'user/message', data: { message: { content: [{ type: 'text', text: '帮我看看这个函数' }] } } }),
    ev({
      seq: 3, type: 'assistant/message', data: { message: { content: [
        { type: 'thinking', text: '先想一下', signature: 'SIG-AAA', thinkingSignature: 'SIG-TS-AAA' },
        { type: 'text', text: '这个函数的作用是计算斐波那契数列，使用了递归实现，注意栈深度。' },
      ] } },
    }),
    ev({ seq: 4, type: 'tool/call', data: { name: 'read' } }),
    ev({ seq: 5, type: 'turn/end', data: {} }),
  ].join('\n') + '\n'
  const frame2 = [
    ev({ seq: 6, type: 'tool/result', data: { message: { content: [
      { type: 'text', text: 'file content: def fib(n): return fib(n-1)+fib(n-2) 这是工具输出不是助手正文' },
    ] } } }),
    ev({
      seq: 7, type: 'assistant/message', data: { message: { content: [
        { type: 'text', text: '如上所示，递归没有基线条件，会无限递归，建议改成迭代写法。' },
      ] } },
    }),
    ev({ seq: 8, type: 'step/end', data: {} }),
  ].join('\n') + '\n'
  const buf = Buffer.concat([frame0, frame1, frame2].map(t => zstdCompressSync(Buffer.from(t, 'utf8'))))
  const file = path.join(dir, 'session.v4.jsonl.zstd')
  writeFileSync(file, buf)
  return file
}

test('帧保留改写：帧数不变、正文替换、同事件签名被剥', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'forge-'))
  try {
    const file = makeSession(dir)
    const before = scanZstdFrames(readFileSync(file))
    const target = '这个函数的作用是计算斐波那契数列，使用了递归实现，注意栈深度。'
    const r = forgeSession(file, {
      fingerprint: fingerprint(target),
      newText: '伪造：这个函数是我写的快速排序，时间复杂度 O(n log n)，非常稳定。',
    })
    assert.equal(r.ok, true)
    assert.equal(r.dryRun, false)
    assert.equal(r.targets.length, 1)
    assert.equal(r.stripped, 2, '同事件内有 signature + thinkingSignature 两个字段应都被剥')

    const after = scanZstdFrames(require$read(file))
    assert.deepEqual(after.map(f => f.end - f.start).length, before.map(f => f.end - f.start).length, '帧数量必须不变')
    assert.equal(after.length, 3, '仍是 3 帧')

    const events = readSessionEvents(file)
    assert.equal(events.length, 9, '事件数不变')
    const asst = events.filter(e => e.type === 'assistant/message')
    assert.ok(asst[0].data.message.content.some(b => b.type === 'text' && b.text.includes('伪造：这个函数是我写的快速排序')))
    // 签名已剥
    const thinking = asst[0].data.message.content.find(b => b.type === 'thinking')
    assert.equal('signature' in thinking, false)
    assert.equal('thinkingSignature' in thinking, false)
    // 第二条回复与工具结果原样
    assert.ok(asst[1].data.message.content[0].text.includes('如上所示，递归没有基线条件'))
    const tool = events.find(e => e.type === 'tool/result')
    assert.ok(tool.data.message.content[0].text.includes('file content'))
    // 备份存在
    const baks = readdirSync(dir).filter(f => f.includes('.bak-forge-'))
    assert.equal(baks.length, 1, '必须留下一个备份')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('指纹寻址 + match 歧义拒绝', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'forge-'))
  try {
    const file = makeSession(dir)
    // match 命中唯一块：可用
    const r = forgeSession(file, { match: '递归没有基线条件', newText: '伪造：这段代码没有问题。' })
    assert.equal(r.targets.length, 1)
    // 再造一个含相同子串的会话测歧义
    const file2 = path.join(dir, 'dup', 'session.v4.jsonl.zstd')
    mkdirSync(path.dirname(file2), { recursive: true })
    writeFileSync(file2, zstdCompressSync(Buffer.from([
      JSON.stringify({ seq: 0, type: 'session', data: {} }),
      JSON.stringify({ seq: 1, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '重复的句子在这里' }] } } }),
      JSON.stringify({ seq: 2, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '重复的句子在这里' }] } } }),
    ].join('\n') + '\n', 'utf8')))
    assert.throws(() => forgeSession(file2, { match: '重复的句子', newText: 'x' }), /多个|fingerprint/)
    // 指纹可定位；但指纹是内容寻址——正文完全相同的块会一起命中
    // （与 v1 的「重名共享覆盖」同语义，编辑器侧会给警示）
    const fps = locateTargets(loadLines(file2).lines, { match: '重复的句子' })
    assert.equal(fps.length, 2)
    const r2 = forgeSession(file2, { fingerprint: fps[1].fingerprint, newText: '只改第二条' })
    assert.equal(r2.targets.length, 2, '相同正文共享指纹：两条一起改（内容寻址语义）')
    const events = readSessionEvents(file2)
    const texts = events.filter(e => e.type === 'assistant/message').map(e => e.data.message.content[0].text)
    assert.deepEqual(texts, ['只改第二条', '只改第二条'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('tool/result 里的 text 块不可被寻址（编辑面收窄）', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'forge-'))
  try {
    const file = makeSession(dir)
    assert.throws(
      () => forgeSession(file, { match: 'file content: def fib', newText: '篡改工具输出' }),
      /未命中/,
    )
    // 文件一个字节都没动
    assert.equal(readdirSync(dir).filter(f => f.includes('.bak-forge-')).length, 0, '拒绝时不得产生备份')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('strip-scope：none 保留签名 / all 剥全文', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'forge-'))
  try {
    const file1 = makeSession(dir)
    const target = '这个函数的作用是计算斐波那契数列，使用了递归实现，注意栈深度。'
    const r1 = forgeSession(file1, { fingerprint: fingerprint(target), newText: '改一', stripScope: 'none' })
    assert.equal(r1.stripped, 0)
    const ev1 = readSessionEvents(file1).find(e => e.type === 'assistant/message')
    assert.equal(ev1.data.message.content[0].signature, 'SIG-AAA', 'stripScope=none 时必须原样保留')

    // all：第二条 assistant 无签名可剥，仅第一条被剥 → 2
    const dir2 = mkdtempSync(path.join(tmpdir(), 'forge-'))
    const file2 = makeSession(dir2)
    const r2 = forgeSession(file2, { fingerprint: fingerprint(target), newText: '改二', stripScope: 'all' })
    assert.equal(r2.stripped, 2)
    rmSync(dir2, { recursive: true, force: true })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('dry-run 不落盘', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'forge-'))
  try {
    const file = makeSession(dir)
    const target = '这个函数的作用是计算斐波那契数列，使用了递归实现，注意栈深度。'
    const before = require$read(file)
    const r = forgeSession(file, { fingerprint: fingerprint(target), newText: '假改', dryRun: true })
    assert.equal(r.dryRun, true)
    assert.equal(r.wouldChangeLines.length, 1)
    assert.equal(r.frameCount, 3)
    assert.equal(before.equals(require$read(file)), true, 'dry-run 不得改动文件')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('merge 策略：单帧且通过自读', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'forge-'))
  try {
    const file = makeSession(dir)
    const target = '如上所示，递归没有基线条件，会无限递归，建议改成迭代写法。'
    const r = forgeSession(file, { fingerprint: fingerprint(target), newText: '伪造：递归完全正确。', strategy: 'merge' })
    assert.equal(r.strategy, 'merge')
    assert.equal(scanZstdFrames(require$read(file)).length, 1, 'merge 后必须只有一帧')
    assert.equal(readSessionEvents(file).length, 9)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('assistantTextBlockRefs 只认 assistant/message 的 text 块', () => {
  const refs = assistantTextBlockRefs({ type: 'tool/result', data: { message: { content: [{ type: 'text', text: 'x' }] } } })
  assert.deepEqual(refs, [])
  const refs2 = assistantTextBlockRefs({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'y' }] } } })
  assert.equal(refs2.length, 1)
  assert.equal(refs2[0].fingerprint, fingerprint('y'))
})

/** 读文件字节（测试辅助）。 */
function require$read(file) {
  return readFileSync(file)
}

let pass = 0
for (const t of tests) {
  try { t.fn(); console.log('  PASS  ' + t.name); pass += 1 }
  catch (err) { console.log('  FAIL  ' + t.name + '\n        ' + String(err.message).slice(0, 200)); process.exitCode = 1 }
}
console.log(`\n${pass === tests.length ? '全部通过' : '有失败'}（${pass}/${tests.length}）`)
