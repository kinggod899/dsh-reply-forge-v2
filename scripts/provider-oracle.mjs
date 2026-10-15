// provider 预言机（scripts/provider-oracle.mjs）：回答一个环境侧问题——
// 「dsh 启动后到底注册了哪些 LLM provider？」
//
// 背景：2026-10-15 用户报告 dsh-our-free-model 的 13 个账号渠道全部不可用，
// 报 NO_ADAPTER（no adapter registered for provider "workbuddy"）。该插件
// 的包目录曾因 pnpm EPERM 被清掉，已用真实副本补回；本脚本用来证明
// 「补回之后 provider 是否真的注册上了」。
//
// 做法：**照抄 App 的真实启动配方**（@deepseek-ai/dsh/lib/profile-boot-*.js
// 的 runProfile），而不是自己拼 boot 参数——这一点踩过坑：
//   * boot() 的 ctx.baseUrl 来自「配置文件所在目录」。leaf 写进 tmp 目录 →
//     裸包名 dsh-our-free-model 解析不到 → "failed to import"（假故障）。
//     真实做法：rootConfig = <profile>/cordis.yml（内容就是 `[]`）。
//   * 双锚点模块解析不是 boot() 的参数，而是 prepare 里挂的
//     hostCtx.plugin(PluginPackages, { resolution: createRuntimeResolution(...) })。
//     App 调 boot() 时根本不传 bareModuleBaseUrl。
//   * 必须先 hostCtx.provide('profileContext', ...)，否则
//     readProfilePatches/prepareProfilePatches 原样返回未解析的裸包名，
//     而且 dsh-base 里 `disabled: !!js "!ctx.get('profileContext')"` 的
//     desktop 专属条目会全部被关掉。
// 然后直连 RPC：
//   session/modelCatalog → ctx.llm.listProviders() 的浏览器侧投影，
//                          返回 { groups:[{kind:'group',group:{id,name,models}}], failures:[] }
//
// 用法：
//   node scripts/provider-oracle.mjs                 # 全 profile（默认）
//   node scripts/provider-oracle.mjs --port 3081
//   node scripts/provider-oracle.mjs --keep base,web-app,free   # 只留三层（快）
//   PROVIDER_ORACLE_BOOT=1 打印 boot 期间捕获的 console 输出
//   PROVIDER_ORACLE_JSON=1 打印 modelCatalog 原始 JSON
//
// 依赖：DSH_HOST_DIR 或 scripts/diag.config.json 的 hostDir
//   = DeepSeek Harness 桌面端自带的 dsh 安装目录（<安装目录>/resources/app/dsh）
import { pathToFileURL, fileURLToPath } from 'node:url'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { requireCheckout } from '../src/checkout.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

let cfg = {}
if (existsSync(join(HERE, 'diag.config.json'))) {
  try { cfg = JSON.parse(readFileSync(join(HERE, 'diag.config.json'), 'utf8')) } catch { cfg = {} }
}

const HOST_DIR = process.env.DSH_HOST_DIR ?? cfg.hostDir ?? ''
if (HOST_DIR === '') {
  console.error('缺少 dsh 安装目录。请设 DSH_HOST_DIR=<桌面端>/resources/app/dsh，')
  console.error('或创建 scripts/diag.config.json：{ "hostDir": "<桌面端>/resources/app/dsh" }')
  process.exit(1)
}
const require2 = requireCheckout(HOST_DIR)
const bootPkg = pathToFileURL(require2.resolve('@deepseek-ai/dsh-app-boot')).href
const { boot, loadProfileDirectory, createRuntimeResolution, readProfilePatches, PluginPackages } = await import(bootPkg)
const { provideCmdline } = await import(pathToFileURL(require2.resolve('@deepseek-ai/dsh-cmdline')).href)

const args = process.argv.slice(2)
const opt = {}
for (let i = 0; i < args.length; i += 1) {
  if (!args[i].startsWith('--')) continue
  opt[args[i].slice(2)] = args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[++i] : true
}

const HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const PROFILE = process.env.DSH_PROFILE ?? cfg.profile ?? join(HOME, 'profiles', 'desktop')
const PORT = String(opt.port ?? 3081)
const NAME = 'dsh'
// installAnchor = 安装自己的 package.json（@deepseek-ai/dsh/package.json）。
const INSTALL_ANCHOR = require2.resolve('@deepseek-ai/dsh/package.json')

const profile = loadProfileDirectory(NAME, PROFILE, INSTALL_ANCHOR)
console.log('[oracle] profile=' + profile.dir)
console.log('[oracle] 层（' + profile.layers.length + '）：' + profile.layers.map(l => l.packageName).join(', '))

// --keep 时把 layers 裁到指定子集（快速排障用；默认全量，与 App 一致）。
let effective = profile
if (typeof opt.keep === 'string') {
  const ALIAS = { base: '@deepseek-ai/dsh-base', 'web-app': '@deepseek-ai/dsh-web-app', free: 'dsh-our-free-model' }
  const keep = new Set(String(opt.keep).split(',').map(s => s.trim()).filter(Boolean).map(s => ALIAS[s] ?? s))
  const layers = profile.layers.filter(l => keep.has(l.packageName))
  const missing = [...keep].filter(n => !profile.layers.some(l => l.packageName === n))
  if (missing.length > 0) console.log('[oracle] 警告：找不到层 → ' + missing.join(', '))
  if (layers.length === 0) { console.error('[oracle] --keep 之后没有层了'); process.exit(1) }
  effective = { ...profile, layers }
  console.log('[oracle] 裁剪后层：' + layers.map(l => l.packageName).join(', '))
}

const resolution = await createRuntimeResolution({ installAnchor: INSTALL_ANCHOR, profile: effective, home: HOME })
console.log('[oracle] resolution 条目=' + resolution.entries.length
  + '（installation=' + resolution.entries.filter(e => e.scope === 'installation').length
  + ' profile=' + resolution.entries.filter(e => e.scope === 'profile').length + '）')

const profileContext = {
  name: 'desktop',
  dir: effective.dir,
  patchPath: effective.patchPath,
  installAnchor: INSTALL_ANCHOR,
  startedBundles: effective.layers.map(l => l.packageName),
  cwd: process.cwd(),
  home: HOME,
  overlays: [],
  telemetryDisabledEnv: process.env.DSH_TELEMETRY_DISABLED,
}

// 真实做法：rootConfig 就是 profile 根 cordis.yml（内容 `[]`），
// 这样 ctx.baseUrl 落在 profile 目录上。
const ROOT_CONFIG = join(effective.dir, 'cordis.yml')
if (!existsSync(ROOT_CONFIG)) { console.error('[oracle] 找不到 profile 根配置：' + ROOT_CONFIG); process.exit(1) }
const patches = readProfilePatches(NAME, profileContext, effective)
console.log('[oracle] 预处理后的 patch 条数=' + patches.length)

const captured = []
const origs = {}
for (const m of ['log', 'info', 'warn', 'error', 'debug']) {
  origs[m] = console[m]
  console[m] = (...a) => { captured.push(m + ': ' + a.map(String).join(' ')) }
}
// logger 可能直接写 stdout/stderr（dsh 的默认 exporter 就这么干），一并拦下。
const origOut = process.stdout.write.bind(process.stdout)
const origErr = process.stderr.write.bind(process.stderr)
process.stdout.write = (chunk, ...rest) => { captured.push('out: ' + String(chunk)); return true }
process.stderr.write = (chunk, ...rest) => { captured.push('err: ' + String(chunk)); return true }
const restoreIo = () => {
  for (const m of Object.keys(origs)) console[m] = origs[m]
  process.stdout.write = origOut
  process.stderr.write = origErr
}

const findToken = () => {
  const line = captured.find(l => l.includes('token='))
  return line === undefined ? '' : (/token=([A-Za-z0-9._-]+)/.exec(line)?.[1] ?? '')
}

let ctx = null
try {
  ctx = await boot(NAME, ROOT_CONFIG, patches, async hostCtx => {
    hostCtx.provide('profileContext', profileContext)
    await hostCtx.plugin(PluginPackages, { resolution })
    // 诊断开关：pack.js 的 createChannelPackStore 会因为 settings.register
    // 存在而走 SettingsStore（命名空间 channel-pack，可能为空），否则回落到
    // FileStore(~/.dsh/channel-pack/state.json)。真实账号在那份文件里，
    // 所以把 register 抹掉即可复现「读文件」的那条路。
    if (process.env.PROVIDER_ORACLE_FILESTORE === '1') {
      await hostCtx.plugin({
        name: 'oracle-force-filestore',
        inject: ['settings'],
        apply(scope) {
          const settings = scope.settings
          try {
            Object.defineProperty(settings, 'register', { value: undefined, configurable: true })
            console.log('[oracle] 已屏蔽 settings.register（强制 FileStore 分支）')
          } catch (e) { console.log('[oracle] 屏蔽 settings.register 失败：' + String(e).slice(0, 160)) }
        },
      })
    }
    provideCmdline(hostCtx, { args: ['--port', PORT, '--no-open'], exit: () => {} })
  })
} catch (e) {
  restoreIo()
  console.error('[oracle] boot 抛错：' + (e?.stack ?? e))
  process.exit(1)
}

// 全 profile 下 web 服务可能晚于 boot 返回才监听，给它一点时间。
let token = findToken()
for (let i = 0; i < 60 && token === ''; i += 1) {
  await new Promise(r => setTimeout(r, 500))
  token = findToken()
}
restoreIo()

if (process.env.PROVIDER_ORACLE_BOOT === '1') {
  console.log('[oracle] ---- boot 期间捕获的输出 ----')
  for (const l of captured) console.log('  | ' + l.slice(0, 600))
  console.log('[oracle] ---- 结束 ----')
}
if (token === '') { console.error('[oracle] 未捕获到 web URL'); process.exit(1) }
console.log('[oracle] host ok, port=' + PORT + ', home=' + HOME)

const BASE = 'http://127.0.0.1:' + PORT
let cookie = ''
for (let i = 0; i < 40 && cookie === ''; i += 1) {
  try {
    const res = await fetch(`${BASE}/?token=${token}`, { redirect: 'manual' })
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
    if (setCookies.length > 0) cookie = setCookies.map(c => c.split(';')[0]).join('; ')
  } catch { /* 未就绪，重试 */ }
  if (cookie === '') await new Promise(r => setTimeout(r, 500))
}
if (cookie === '') { console.error('[oracle] 未能换取会话 cookie'); process.exit(1) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const rpc = async (method, params) => {
  const res = await fetch(BASE + '/api/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload: { args: params } }),
  })
  const text = await res.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { throw new Error(`status=${res.status} 非 JSON 响应: ${text.slice(0, 200)}`) }
  if (parsed?.result?.ok !== true) throw new Error(`RPC ${method} 失败: ${text.slice(0, 400)}`)
  return parsed.result.value
}

let catalog = null
let lastErr = ''
// 插件的 apply 是异步的（还有 webServer 的 inject 等待），给足重试窗口。
for (let i = 0; i < 60 && catalog === null; i += 1) {
  try { catalog = await rpc('session/modelCatalog', {}) } catch (e) { lastErr = String(e).slice(0, 300); await sleep(500) }
}
if (catalog === null) { console.error('[oracle] session/modelCatalog 调用失败\n  ' + lastErr); process.exit(1) }

// 渠道适配器的模型清单可能要等账号池/远端列举跑完才非空（插件里有
// probeIntervalMinutes / 自动签到等后台节奏）。--wait <秒> 后再取一次，
// 用来区分「冷启动时序」和「真故障」。
const WAIT_S = Number(opt.wait ?? 0)
if (Number.isFinite(WAIT_S) && WAIT_S > 0) {
  const before = (catalog.groups ?? []).map(g => (g.group ?? g).id).join(',')
  console.log(`[oracle] --wait ${WAIT_S}s 后复测 modelCatalog（前：${before}）`)
  await sleep(WAIT_S * 1000)
  try { catalog = await rpc('session/modelCatalog', {}) } catch (e) { console.log('[oracle] 复测失败：' + String(e).slice(0, 200)) }
}

if (process.env.PROVIDER_ORACLE_JSON === '1') console.log('[oracle] raw=' + JSON.stringify(catalog))

const groups = catalog.groups ?? []
const failures = catalog.failures ?? []

// 插件自己的渠道状态位：channelPack.state ∈ pending|ready|failed。
// 这是「13 个登录渠道为什么是空的」的第一手答案（index.js 里
// ctx.inject(['credentials','commands','llm'], ...) 动态 import pack.js 的结果）。
const getJson = async path => {
  const res = await fetch(BASE + path, { headers: { cookie } })
  const text = await res.text()
  try { return JSON.parse(text) } catch { return { __raw: text.slice(0, 300), __status: res.status } }
}
const summary = await getJson('/api/our-free-model/summary')
// `channels` 就是 index.js 里 ctx.inject(['credentials','commands','llm'], ...) 动态
// import pack.js 的结果状态位：pending | ready | failed（failed 带 error 文案）。
console.log('[oracle] channels = ' + JSON.stringify(summary.channels ?? '(字段缺失)'))

// ── 进程内直探凭据库 ─────────────────────────────────────────────────────────
// pack.js 的 providerCatalogVisible → accountPool.hasLoggedInAccount(provider)
// → resolveCredentialByRef(credentialRef) 是「13 渠道有没有模型」的唯一闸门。
// 这里绕过 HTTP，直接问 credentials 服务。
{
  const creds = ctx?.get?.('credentials')
  if (creds === undefined) {
    console.log('[oracle] 没有 credentials 服务')
  } else {
    try {
      const records = creds.listRecords?.()
      console.log('[oracle] credentials.listRecords = ' + (Array.isArray(records) ? records.length + ' 条' : JSON.stringify(records).slice(0, 200)))
    } catch (e) { console.log('[oracle] listRecords 失败：' + String(e).slice(0, 200)) }
    const REFS = [
      'WORKBUDDY_ACCOUNT_808ADFF0', 'BUDDY_ACCOUNT_FA961EEE', 'CODEARTS_ACCOUNT_88DBEA16',
      'LOBSTERAI_ACCOUNT_CCA3C653', 'QODER_ACCOUNT_8BFD0BE5', 'QODERCN_ACCOUNT_53D5F489',
      'TRAE_ACCOUNT_38456E45', 'CLINE_ACCOUNT_E53FE7FD', 'LOOMY_ACCOUNT_19FB820D',
      'RACCOON_ACCOUNT_0A124A2F', 'MINIMAX_ACCOUNT_A8F5C811', 'ZCODE_ACCOUNT_9EA21F42',
      'GEMINI_ACCOUNT_55580F1A',
    ]
    let ok = 0
    for (const ref of REFS) {
      try {
        const value = await creds.resolve(ref)
        if (value === undefined || value === null) { console.log(`   ${ref}: undefined`); continue }
        ok += 1
        console.log(`   ${ref}: OK`)
      } catch (e) { console.log(`   ${ref}: 抛错 ${String(e).slice(0, 160)}`) }
    }
    console.log(`[oracle] 凭据解析成功 ${ok}/${REFS.length}`)
  }
  // 账号池读的是哪个存储？pack.js 的 createChannelPackStore 二选一：
  //   settings.register 是函数 → SettingsStore（命名空间 channel-pack）
  //   否则                     → FileStore(~/.dsh/channel-pack/state.json)
  // 两者内容不同会直接决定 hasLoggedInAccount 的真假。
  const settings = ctx?.get?.('settings')
  console.log('[oracle] settings 服务 = ' + (settings === undefined ? '缺失' : 'ok, typeof register=' + typeof settings.register))
  if (settings !== undefined) {
    for (const m of ['get', 'namespace', 'read', 'snapshot', 'view']) {
      if (typeof settings[m] !== 'function') continue
      try {
        const v = await settings[m]('channel-pack')
        const accounts = v?.accounts ?? v?.value?.accounts
        console.log(`[oracle] settings.${m}('channel-pack') → accounts=` + (Array.isArray(accounts) ? accounts.length : JSON.stringify(v).slice(0, 160)))
      } catch (e) { console.log(`[oracle] settings.${m}('channel-pack') 抛错 ${String(e).slice(0, 120)}`) }
    }
  }
  const fsx = await import('node:fs')
  const statePath = join(HOME, 'channel-pack', 'state.json')
  try {
    const parsed = JSON.parse(fsx.readFileSync(statePath, 'utf8'))
    console.log('[oracle] ' + statePath + ' → accounts=' + (Array.isArray(parsed.accounts) ? parsed.accounts.length : '?'))
  } catch (e) { console.log('[oracle] 读 state.json 失败：' + String(e).slice(0, 160)) }
}if (typeof summary.__raw === 'string') console.log('[oracle] summary 原始响应 = ' + summary.__raw)
if (Array.isArray(summary.catalog)) {
  console.log('[oracle] 插件自有 catalog 条目 = ' + summary.catalog.length)
  for (const e of summary.catalog) {
    console.log('   ' + (e.id ?? '?') + '  channel=' + (e.channel ?? '-') + '  route=' + (e.route ?? '-') + '  avail=' + (e.availability ?? '-'))
  }
}
if (process.env.PROVIDER_ORACLE_JSON === '1') {
  const keys = Object.keys(summary)
  console.log('[oracle] summary keys = ' + keys.join(', '))
}

// 账号池快照：13 渠道 provider 的 models 之所以为空，取决于
// pack.js 的 providerCatalogVisible → accountPool.hasLoggedInAccount(provider)
// → resolveCredentialByRef(credentialRef)。/pool 是这条链路的对外投影。
const pool = await getJson('/api/our-free-model/pool')
if (typeof pool.__raw === 'string') {
  console.log('[oracle] /pool 原始响应 = ' + pool.__raw)
} else {
  const rows = pool.accounts ?? pool.items ?? pool.pool ?? pool
  console.log('[oracle] /pool 顶层 keys = ' + Object.keys(pool).join(', '))
  if (Array.isArray(rows)) {
    console.log('[oracle] 账号数 = ' + rows.length)
    for (const a of rows.slice(0, 20)) {
      console.log('   ' + (a.provider ?? '?') + '/' + (a.id ?? '?')
        + ' enabled=' + (a.enabled ?? '?')
        + ' credential=' + (a.credential !== undefined ? 'yes' : (a.hasCredential ?? a.available ?? '?'))
        + ' nickname=' + (a.nickname ?? ''))
    }
  } else {
    console.log('[oracle] /pool = ' + JSON.stringify(pool).slice(0, 1200))
  }
}

console.log(`[oracle] modelCatalog 里的 provider 组 = ${groups.length}，失败项 = ${failures.length}`)
for (const g of groups) {
  const grp = g.group ?? g
  console.log(`  - ${grp.id}  (${grp.name ?? ''})  models=${(grp.models ?? []).length}`)
}
for (const f of failures) console.log('  ! ' + JSON.stringify(f).slice(0, 200))

// buildModelCatalog 会丢掉 models 为空的 provider（见 dsh-api-session-controller
// 的 `.filter(group => group.models.length > 0)`），所以「组里没有」不等于
// 「注册表里没有」。直接问 llm 服务的注册表。
let rawProviders = null
for (const method of ['llm/listProviders', 'llm/list-providers']) {
  try { rawProviders = await rpc(method, {}); console.log('[oracle] ' + method + ' OK'); break } catch (e) { lastErr = String(e).slice(0, 200) }
}
if (rawProviders === null) {
  console.log('[oracle] 拿不到原始 provider 注册表（' + lastErr + '），退回用 modelCatalog 判定')
}
const rawIds = rawProviders === null ? groups.map(g => (g.group ?? g).id) : rawProviders.map(p => p.id ?? p.provider ?? String(p))
console.log(`[oracle] llm 注册表 provider = ${rawIds.length} → ${rawIds.join(', ')}`)

// 13 个账号渠道的 provider id。
const CHANNELS = ['workbuddy', 'codearts', 'lobsterai', 'qoder', 'qodercn', 'trae', 'gemini', 'zcode', 'minimax', 'raccoon', 'loomy', 'buddy', 'cline']
const present = new Set(rawIds)
const hit = CHANNELS.filter(c => present.has(c))
const miss = CHANNELS.filter(c => !present.has(c))
console.log(`[oracle] 13 渠道 provider 命中 ${hit.length}/13 → ${hit.join(', ') || '(无)'}`)
if (miss.length > 0) console.log(`[oracle] 缺席 → ${miss.join(', ')}`)

// 注册了但 models 为空的 provider：查它的 listModels。
const inGroups = new Set(groups.map(g => (g.group ?? g).id))
const empty = rawIds.filter(id => !inGroups.has(id))
if (empty.length > 0) {
  console.log(`[oracle] 注册了但 modelCatalog 里没出现（models 为空或被丢弃）= ${empty.length} → ${empty.join(', ')}`)
  for (const id of empty.slice(0, 15)) {
    try {
      const models = await rpc('llm/listModels', { provider: id })
      console.log(`   ${id}: listModels=${Array.isArray(models) ? models.length : JSON.stringify(models).slice(0, 120)}`)
    } catch (e) { console.log(`   ${id}: listModels 失败 → ${String(e).slice(0, 160)}`) }
  }
}
process.exit(hit.length > 0 ? 0 : 2)
