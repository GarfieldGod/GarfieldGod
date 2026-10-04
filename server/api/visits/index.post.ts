import type { H3Event } from 'h3'

// 访客统计上报端：公开接口，前台每次整页加载调用一次。
// 永远返回 204——统计失败绝不能影响页面可用性，前端也据此静默处理。

// 取客户端真实 IP。可信来源只有两个，且都不采信可被请求方随意伪造的 X-Forwarded-For：
//   1) 配了 GG_ACCESS_SECRET 时，只有携带该共享密钥（由 Cloudflare Transform Rule 注入）
//      的请求才采信 CF-Connecting-IP；直连源站伪造 CF 头的请求会拿不到密钥，退回真实连接地址。
//   2) 未配密钥时沿用 CF-Connecting-IP，安全性取决于源站锁定（Tunnel 或仅放行 CF 回源 IP）。
function clientIp(event: H3Event): string {
  const secret = process.env.GG_ACCESS_SECRET
  if (secret && !safeEqual(event.node.req.headers['x-gg-access-secret'] as string, secret)) {
    return getRequestIP(event) ?? ''
  }
  const cf = event.node.req.headers['cf-connecting-ip']
  if (typeof cf === 'string' && cf.trim()) return cf.trim()
  return getRequestIP(event) ?? ''
}

export default defineEventHandler((event) => {
  try {
    recordVisit(clientIp(event))
  } catch (err) {
    // 表损坏、磁盘写满等都不该让访客看到报错，但要在服务端留痕以便排查
    console.error('[visits] 记录访问失败：', err)
  }
  setResponseStatus(event, 204)
  return null
})