// HTTP 路由：会话落盘记录的读与写（v2 host half）。
//
// 路由形态与邻居插件 dsh-tavern 的生产用法一致：
// { kind: 'exact', path, handler } + ctx.webServer.register(route)，
// handler 收原生 node req/res，自行回 JSON。POST 需要自己读 body。
//
// 依赖 src/ 下的两个模块，用**相对路径**导入而不是拷贝一份：
// v1 把 session-log.mjs 复制进 .dsh-plugin/server/，代价是两份代码会漂移
// ——这正是本项目反复踩到的 bug 类型（README 状态漂移、指纹算法漂移）。
// 前提是插件以 junction/软链方式安装到整个仓库（见 README 的安装说明）。
//
// 安全边界：
//   - 读路由只读；sessionId 经 findSessionFile 的安全字符校验，
//     目录穿越在入口被拦死；
//   - 写路由要求自定义请求头 x-rf2-forge，避免同源下其它脚本误触；
//     body 有大小上限；写前做陈旧校验；写后自读校验不过自动还原。

import {
  assistantTextBlocks, findSessionFile, readSessionEvents,
  sessionsRootDefault, thinkingSignatureStats,
} from '../../src/session-log.mjs'
import { forgeSession } from '../../src/session-write.mjs'

/** 请求体上限：正文再长也不该超过这个量级。 */
const MAX_BODY_BYTES = 2 * 1024 * 1024

/** 新正文上限。 */
const MAX_TEXT_CHARS = 512 * 1024

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

/** 读 POST body（JSON）。超限或非法 JSON 一律 reject。 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) { reject(new Error('body-too-large')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch { reject(new Error('invalid-json')) }
    })
    req.on('error', reject)
  })
}

/**
 * 注册本插件的路由。webServer 缺失（个别 profile 无该服务）时静默跳过：
 * 浏览器 half 的本机渲染能力不依赖宿主侧路由。
 * @param {{ register: Function } | undefined} webServer 宿主 webServer 服务
 */
export function registerRoutes(webServer) {
  if (webServer === undefined || webServer === null || typeof webServer.register !== 'function') return

  // ── 读：会话落盘的助手正文块（供 UI 做 DOM ↔ 磁盘定位）────────────────
  webServer.register({
    kind: 'exact',
    path: '/api/reply-forge-v2/session/blocks',
    handler: (req, res) => {
      if (req.method !== 'GET') { json(res, 405, { ok: false, error: 'method-not-allowed' }); return }
      let url
      try { url = new URL(req.url, 'http://127.0.0.1') }
      catch { json(res, 400, { ok: false, error: 'bad request url' }); return }
      const sessionId = url.searchParams.get('sessionId') ?? ''
      if (sessionId === '') { json(res, 400, { ok: false, error: 'sessionId required' }); return }
      const file = findSessionFile(sessionsRootDefault(), sessionId)
      if (file === null) { json(res, 404, { ok: false, error: 'session log not found' }); return }
      try {
        const events = readSessionEvents(file)
        // UI 只需要「能定位」：seq + 块索引 + 原文。不回传指纹——浏览器
        // 用不上它（它改用 seq 寻址），少传一份就少一处不一致。
        const blocks = assistantTextBlocks(events)
        json(res, 200, {
          ok: true,
          sessionId,
          file: String(file),
          events: events.length,
          total: blocks.length,
          blocks: blocks.map(b => ({ seq: b.seq, blockIndex: b.blockIndex, text: b.text })),
          signatures: thinkingSignatureStats(events),
        })
      } catch (error) {
        json(res, 500, { ok: false, error: String((error && error.message) || error) })
      }
    },
  })

  // ── 写：改写一条助手正文（落盘）──────────────────────────────────────
  webServer.register({
    kind: 'exact',
    path: '/api/reply-forge-v2/session/forge',
    handler: (req, res) => {
      if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'method-not-allowed' }); return }
      // 自定义头挡住「同源下别的脚本顺手 POST 一下」这种误触。
      if (req.headers['x-rf2-forge'] !== '1') {
        json(res, 403, { ok: false, error: 'missing x-rf2-forge header' })
        return
      }
      readBody(req).then(body => {
        try {
          const b = (body === null || typeof body !== 'object') ? {} : body
          const sessionId = typeof b.sessionId === 'string' ? b.sessionId : ''
          if (sessionId === '') { json(res, 400, { ok: false, error: 'sessionId required' }); return }
          if (typeof b.newText !== 'string' || b.newText.trim() === '') {
            json(res, 400, { ok: false, error: 'newText required' }); return
          }
          if (b.newText.length > MAX_TEXT_CHARS) {
            json(res, 413, { ok: false, error: 'newText too long' }); return
          }
          if (typeof b.seq !== 'number' || typeof b.blockIndex !== 'number') {
            json(res, 400, { ok: false, error: 'seq and blockIndex required' }); return
          }
          const file = findSessionFile(sessionsRootDefault(), sessionId)
          if (file === null) { json(res, 404, { ok: false, error: 'session log not found' }); return }

          const result = forgeSession(file, {
            seq: b.seq,
            blockIndex: b.blockIndex,
            newText: b.newText,
            // 陈旧校验：UI 看到的那份原文必须与磁盘当前一致。
            expectText: typeof b.expectText === 'string' ? b.expectText : undefined,
            strategy: 'preserve',
            stripScope: typeof b.stripScope === 'string' ? b.stripScope : 'same-event',
          })
          json(res, 200, {
            ok: true,
            sessionId,
            file: String(file),
            target: { seq: b.seq, blockIndex: b.blockIndex },
            stripped: result.stripped,
            backup: result.backup,
            verify: result.verify,
          })
        } catch (error) {
          // 业务失败一律 200 + ok:false：UI 要拿 code/actual 做分支，
          // 而不是解析 HTTP 状态码。
          json(res, 200, {
            ok: false,
            error: String((error && error.message) || error),
            code: typeof error?.code === 'string' ? error.code : null,
            actual: typeof error?.actual === 'string' ? error.actual : null,
            backup: typeof error?.backup === 'string' ? error.backup : null,
          })
        }
      }).catch(error => {
        json(res, 400, { ok: false, error: String((error && error.message) || error) })
      })
    },
  })
}
