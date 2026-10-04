import { createHash, timingSafeEqual } from 'node:crypto'

export const ADMIN_COOKIE = 'gg_admin'
export const ADMIN_LOGIN_PATH = '/admin/login'

// 后台访问守卫的放行模式，优先级从高到低：
//   1. GG_ADMIN_PASSWORD 已设置 —— 需要口令换取的会话 cookie（本地开发与未接入 Access 时使用）
//   2. GG_TRUST_ACCESS=1 —— 信任 Cloudflare Access，要求请求携带已认证用户头（接入 Access 后启用）
//   3. 非生产环境 —— 直接放行
// 生产环境三者都不满足时返回 403，避免后台裸奔。
export function adminMode(): 'password' | 'access' | 'dev' | 'locked' {
  if (process.env.GG_ADMIN_PASSWORD) return 'password'
  if (process.env.GG_TRUST_ACCESS === '1') return 'access'
  if (process.env.NODE_ENV !== 'production') return 'dev'
  return 'locked'
}

export function sessionToken(password: string): string {
  return createHash('sha256').update(`gg-admin:${password}`).digest('hex')
}

export function verifySession(cookieValue: string | undefined): boolean {
  const password = process.env.GG_ADMIN_PASSWORD
  if (!password || !cookieValue) return false
  const a = Buffer.from(sessionToken(password))
  const b = Buffer.from(cookieValue)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function safeEqual(value: string | undefined, expected: string): boolean {
  if (!value) return false
  const a = Buffer.from(value)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

// Cloudflare Access 模式下的信任判定：设了共享密钥时必须带对请求头，
// 且必须有 Access 注入的已认证用户头。缺一不可，否则源站被直连时能靠伪造头绕过。
export function accessVerified(event: any): boolean {
  const secret = process.env.GG_ACCESS_SECRET
  if (secret && !safeEqual(event.node.req.headers['x-gg-access-secret'] as string, secret)) {
    return false
  }
  return Boolean(event.node.req.headers['cf-access-authenticated-user-email'])
}
