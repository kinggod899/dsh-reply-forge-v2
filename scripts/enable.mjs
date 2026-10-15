// 一键启用 dsh-reply-forge-v2（在已安装的前提下）。
//
// 使用时机：任何时候。双击仓库根的「启用插件.bat」，
// 或在任意终端执行：node scripts/enable.mjs
//
// 与「安装插件.bat」的区别：本脚本不建链接、不写 lockfile，只做两件
// 启动时读取的静态配置改动 —— 把插件加回 bundles、清掉它的 disabled 条目。
//
// 注意：如果 v1（@local/dsh-reply-forge）也在 bundles 里，两个插件会同时
// 在每条回复下挂一条操作条。本脚本默认顺手把 v1 摘掉；想两个都开加
// --keep-v1。

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import {
  paths, PKG_ID, PATCH_ID, V1_PKG_ID, V1_PATCH_ID,
  warnIfRunning, backup, readJson, writeJson, removePatchEntry, verify,
} from './profile-lib.mjs'

const argv = process.argv.slice(2)
const disableV1 = argv.includes('--keep-v1') === false

const log = (...a) => console.log('[enable]', ...a)
const fail = msg => { console.error('[enable] 失败：' + msg); process.exit(1) }

const p = paths()
warnIfRunning(log)

// package.json：dependencies 必须已在位（否则说明没装过）
const pkgPath = p.PKG_JSON
if (existsSync(pkgPath) === false) fail('未找到 ' + pkgPath)
const pkg = readJson(pkgPath)
const bundles = pkg?.dsh?.profile?.bundles
if (Array.isArray(bundles) === false) fail('package.json 缺少 dsh.profile.bundles 数组')
if (typeof pkg?.dependencies?.[PKG_ID] !== 'string') {
  fail('dependencies 缺少 ' + PKG_ID + '：请先运行「安装插件.bat」')
}

let changed = false
if (bundles.includes(PKG_ID) === false) { bundles.push(PKG_ID); changed = true; log('bundles 已加入 ' + PKG_ID) }
else log('bundles 已包含 ' + PKG_ID + '，跳过')

if (disableV1) {
  const next = bundles.filter(b => b !== V1_PKG_ID)
  if (next.length !== bundles.length) { pkg.dsh.profile.bundles = next; changed = true; log('已从 bundles 摘掉 v1') }
}
if (changed) {
  const b = backup(pkgPath, 'enable')
  writeJson(pkgPath, pkg)
  log('package.json 已更新（备份 ' + b + '）')
}

// cordis.patch.yml：清掉两个插件的 disabled 条目
if (existsSync(p.PATCH_YML)) {
  let raw = readFileSync(p.PATCH_YML, 'utf8')
  const r2 = removePatchEntry(raw, PATCH_ID)
  if (r2.removed > 0) { raw = r2.text; log('已移除 ' + r2.removed + ' 条 ' + PATCH_ID + ' disabled 条目') }
  if (disableV1) {
    const r1 = removePatchEntry(raw, V1_PATCH_ID)
    if (r1.removed > 0) { raw = r1.text; log('已移除 ' + r1.removed + ' 条 v1 disabled 条目') }
  }
  writeFileSync(p.PATCH_YML, raw)
}

log('自检')
const bad = verify(p, log)
console.log('')
if (bad > 0) fail('有 ' + bad + ' 项未就位：请先完全退出 DSH，再运行「安装插件.bat」')
console.log('启用就绪。请完全退出并重启 DSH 桌面端加载插件。')
console.log('若启动异常，运行「关闭插件.bat」一键回滚。')
