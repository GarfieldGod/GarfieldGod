export default defineEventHandler(async (event) => {
  const method = getMethod(event)
  const mode = adminMode()

  if (method === 'GET') {
    return {
      mode,
      authenticated: authenticatedFor(event, mode),
    }
  }

  if (method === 'POST') {
    const expected = process.env.GG_ADMIN_PASSWORD
    if (!expected) {
      throw createError({ statusCode: 400, message: '未设置 GG_ADMIN_PASSWORD，无需口令登录' })
    }
    const body = await readBody(event)
    if (String(body?.password ?? '') !== expected) {
      throw createError({ statusCode: 401, message: '口令不正确' })
    }
    setCookie(event, ADMIN_COOKIE, sessionToken(expected), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 8,
    })
    return { ok: true }
  }

  if (method === 'DELETE') {
    deleteCookie(event, ADMIN_COOKIE, { path: '/' })
    return { ok: true }
  }

  throw createError({ statusCode: 405, message: '不支持的请求方法' })
})

// 是否已通过后台鉴权：dev 视为已登录（本地不设鉴权），
// access 必须带真正的 Cloudflare Access 头，password 需要有效会话 cookie，locked 一律未登录。
function authenticatedFor(event: any, mode: ReturnType<typeof adminMode>): boolean {
  if (mode === 'dev') return true
  if (mode === 'access') return accessVerified(event)
  if (mode === 'password') return verifySession(getCookie(event, ADMIN_COOKIE))
  return false
}
