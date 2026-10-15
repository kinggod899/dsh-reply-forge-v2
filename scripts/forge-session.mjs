// 伪造写入 CLI（scripts/forge-session.mjs，v2.0 关闭态写入器）。
//
// 用法：
//   node scripts/forge-session.mjs --session <id> --list
//   node scripts/forge-session.mjs --session <id> --match "<原文子串>" --text "<新正文>" --dry-run
//   node scripts/forge-session.mjs --session <id> --fingerprint <fp> --text-file new.md
//   node scripts/forge-session.mjs --file <会话文件路径> --match "..." --text "..."
//   node scripts/forge-session.mjs --restore --file <会话文件> --backup <备份文件>
//
// 选项：
//   --strategy preserve|merge   帧策略，默认 preserve（逐帧重压，边界不变）
//   --strip-scope same-event|all|none   剥签名范围，默认 same-event
//   --allow-running             dsh 正在运行也允许写（默认拒绝：v2.0 是关闭态写入，
//                               运行态热写入是 v2.1 的事）
//   --dry-run                   只报告将改动什么，不落盘
//
// 安全网：整文件备份（.bak-forge-<ts>）→ 原子写 → 写后自读校验，失败自动还原。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  forgeSession, loadLines, locateTargets, fingerprint, readSessionEvents,
} from '../src/session-write.mjs'
import { findSessionFile, sessionsRootDefault, assistantTextBlocks } from '../src/session-log.mjs'

const args = process.argv.slice(2)
const opt = {}
for (let i = 0; i < args.length; i += 1) {
  const a = args[i]
  if (!a.startsWith('--')) continue
  const key = a.slice(2)
  const next = args[i + 1]
  if (next === undefined || next.startsWith('--')) { opt[key] = true; continue }
  opt[key] = next
  i += 1
}

const log = (...a) => console.log('[forge]', ...a)
const die = msg => { console.error('[forge] 错误：' + msg); process.exit(1) }

if (opt.restore === true) {
  if (opt.file === undefined || opt.backup === undefined) die('--restore 需要 --file 与 --backup')
  if (!existsSync(opt.backup)) die('备份不存在：' + opt.backup)
  const { copyFileSync } = await import('node:fs')
  copyFileSync(opt.backup, opt.file)
  log('已从备份还原：' + opt.backup + ' → ' + opt.file)
  process.exit(0)
}

// 目标文件
let file = opt.file
if (file === undefined) {
  if (opt.session === undefined) die('需要 --file 或 --session')
  const root = sessionsRootDefault()
  file = findSessionFile(root, opt.session)
  if (file === null) die('找不到会话 ' + opt.session + '（root=' + root + '）')
}
if (existsSync(file) === false) die('文件不存在：' + file)
log('目标文件: ' + file + '（' + statSync(file).size + 'B）')

// dsh 运行中检测（v2.0 = 关闭态写入）
if (opt['allow-running'] !== true) {
  let running = false
  try {
    const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq DeepSeek Harness.exe'], { encoding: 'buffer' })
    const text = Buffer.from(r.stdout ?? Buffer.alloc(0)).toString('utf16le') + Buffer.from(r.stdout ?? Buffer.alloc(0)).toString('latin1')
    running = /DeepSeek Harness\.exe/i.test(text)
  } catch { /* 检测失败不阻塞，仅警告 */ }
  if (running) {
    die('检测到 DSH 桌面端正在运行。v2.0 是关闭态写入：请先完全退出 DSH 再执行；'
      + '确认要在运行中写入请加 --allow-running（自读校验仍会兜底，但宿主内存态可能覆盖，属 v2.1 未验证领域）')
  }
}

const loaded = loadLines(file)

// --list：列出全部可寻址块
if (opt.list === true) {
  const blocks = assistantTextBlocks(readSessionEvents(file))
  if (blocks.length === 0) die('该会话没有 assistant/message text 块')
  log('可寻址的助手正文块（' + blocks.length + ' 个）：')
  for (const b of blocks) {
    const preview = b.text.replace(/\s+/g, ' ').trim()
    console.log(`  fp=${fingerprint(b.text)}  seq=${b.seq ?? '-'}  「${preview.slice(0, 56)}${preview.length > 56 ? '…' : ''}」`)
  }
  console.log('\n用 --fingerprint <fp> 精确定位；--match 在命中多个时会拒绝执行。')
  process.exit(0)
}

// 目标
if (opt.fingerprint === undefined && opt.match === undefined) die('需要 --fingerprint 或 --match（先用 --list 查看）')
if (opt.text === undefined && opt['text-file'] === undefined) die('需要 --text 或 --text-file')
let newText = opt.text
if (opt['text-file'] !== undefined && opt['text-file'] !== true) {
  if (existsSync(opt['text-file']) === false) die('文本文件不存在：' + opt['text-file'])
  newText = readFileSync(opt['text-file'], 'utf8')
}

const where = opt.fingerprint !== undefined ? { fingerprint: opt.fingerprint } : { match: opt.match }
const hits = locateTargets(loaded.lines, where)
if (hits.length === 0) die('未命中任何 assistant/message text 块')
if (hits.length > 1 && opt.fingerprint === undefined) {
  log('match 命中多个块，请改用 --fingerprint：')
  for (const h of hits) console.log(`  fp=${h.fingerprint}  seq=${h.seq ?? '-'}  「${h.text.replace(/\s+/g, ' ').slice(0, 50)}…」`)
  process.exit(1)
}
for (const h of hits) {
  log(`命中 seq=${h.seq ?? '-'} fp=${h.fingerprint}：`)
  console.log('  旧：' + h.text.replace(/\s+/g, ' ').slice(0, 100) + (h.text.length > 100 ? '…' : ''))
  console.log('  新：' + newText.replace(/\s+/g, ' ').slice(0, 100) + (newText.length > 100 ? '…' : ''))
}

const result = forgeSession(file, {
  ...where,
  newText,
  strategy: opt.strategy === undefined ? 'preserve' : opt.strategy,
  stripScope: opt['strip-scope'] === undefined ? 'same-event' : opt['strip-scope'],
  dryRun: opt['dry-run'] === true,
})

if (result.dryRun) {
  log(`dry-run 完成：将改动第 ${result.wouldChangeLines.join(',')} 行（共 ${result.frameCount} 帧，策略 ${result.strategy}），未落盘`)
  process.exit(0)
}
log('写入成功：')
log('  策略: ' + result.strategy + '，剥离签名字段: ' + result.stripped + ' 个')
log('  自读校验: ' + JSON.stringify(result.verify))
log('  备份: ' + result.backup)
log('回滚: node scripts/forge-session.mjs --restore --file "' + file + '" --backup "' + result.backup + '"')
log('重启 DSH 后打开该会话，模型上下文即为伪造上文。')
