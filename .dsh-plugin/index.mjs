// dsh-reply-forge v2 Node half：宿主侧读写地基。
//
// 分层契约：
//   - 浏览器 half（.dsh-plugin/client.js，构建产物）：UI、就地编辑、
//     localStorage 本机渲染覆盖；通过本文件注册的路由读会话记录、写落盘改写。
//   - 本文件（Node half）：只消费宿主 webServer 服务注册两条路由。真正的
//     改写逻辑在 src/session-write.mjs（与 CLI 共用同一份实现）。
//
// 路由注册形态与邻居插件 dsh-tavern 一致：ctx.webServer.register。
// webServer 服务缺失时静默降级——浏览器 half 的本机渲染能力不依赖宿主侧。
//
// 契约：官方 bundle 插件 Node half（package.json 的 dsh.bundle + dsh.client；
// 产物 build-client.mjs 只处理浏览器 half）。

import { registerRoutes } from './server/routes.mjs'

export const name = '@local/dsh-reply-forge-v2'

export const inject = ['webServer']

export function apply(ctx) {
  try {
    registerRoutes(ctx?.webServer)
  } catch {
    // 宿主服务异常绝不影响插件加载；浏览器 half 不受影响
  }
}
