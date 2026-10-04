const OPEN_PATHS = ['/api/admin/session']

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname
  const isApi = path.startsWith('/api/admin')
  const isPage = path === '/admin' || path.startsWith('/admin/')
  if (!isApi && !isPage) return
  if (OPEN_PATHS.some((p) => path.startsWith(p))) return
  if (path === ADMIN_LOGIN_PATH) return

  const mode = adminMode()
  if (mode === 'dev') return

  if (mode === 'access') {
    // 源站默认只应接受经 Cloudflare 回源的请求（Tunnel 或仅放行 CF 回源 IP）。
    // 若源站 IP 可能暴露，再设 GG_ACCESS_SECRET，并由 Transform Rule 注入同名请求头，
    // 这样即便攻击者伪造 CF-Access-* 头也无法绕过。
    if (accessVerified(event)) return
    return deny(event, isApi)
  }

  if (mode === 'password') {
    if (verifySession(getCookie(event, ADMIN_COOKIE))) return
    return deny(event, isApi)
  }

  throw createError({
    statusCode: 403,
    message: '后台未启用访问控制。请设置 GG_ADMIN_PASSWORD，或接入 Cloudflare Access 后设置 GG_TRUST_ACCESS=1。',
  })
})

function deny(event: any, isApi: boolean) {
  if (isApi) throw createError({ statusCode: 401, message: '未登录' })
  const next = encodeURIComponent(getRequestURL(event).pathname)
  return sendRedirect(event, `${ADMIN_LOGIN_PATH}?next=${next}`, 302)
}
