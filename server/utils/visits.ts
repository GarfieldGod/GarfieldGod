// 访客统计：只存 IP 的加盐 SHA-256 哈希，不存明文 IP。
// 明细走 visit_log（(ip_hash, day) 唯一，天然完成「同一 IP 每天只算一次」）；
// 累计口径走 visit_visitor（每个 IP 一行），二者分开是为了让明细可以按保留期清理
// 而不影响累计数。
import { createHash, randomBytes } from 'node:crypto'
import { useDb } from './db'

/** 趋势图天数（含今天） */
export const TREND_DAYS = 7
/** 明细保留天数：趋势只需 TREND_DAYS 天，留出余量后清理，避免 visit_log 无限膨胀 */
const KEEP_DAYS = Math.max(TREND_DAYS, Number(process.env.GG_VISIT_KEEP_DAYS) || 90)

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * 服务器本地自然日，格式 YYYY-MM-DD。
 * 注意：以服务器本地时区划分「一天」——若服务器跑在 UTC，「今天」对东八区用户
 * 会在早上 8 点翻篇。个人站可接受，需要精确到访客时区就得额外记录偏移量。
 */
export function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

let cachedSalt: string | null = null

/**
 * IP 哈希用的盐。优先取 GG_VISIT_SALT；未设置时生成一次随机盐并落库复用。
 * 不再内置固定盐：源码公开后，IPv4 仅约 43 亿种，固定盐会让哈希可被穷举反查。
 */
function visitSalt(): string {
  if (cachedSalt) return cachedSalt
  const env = process.env.GG_VISIT_SALT?.trim()
  if (env) {
    cachedSalt = env
    return cachedSalt
  }
  const db = useDb()
  const row = db.prepare('SELECT value FROM site_meta WHERE key = ?').get('visit:salt') as
    | { value: string }
    | undefined
  cachedSalt =
    row?.value ??
    (() => {
      const generated = randomBytes(32).toString('hex')
      db.prepare('INSERT OR REPLACE INTO site_meta (key, value) VALUES (?, ?)').run(
        'visit:salt',
        generated,
      )
      return generated
    })()
  return cachedSalt
}

export function hashIp(ip: string): string {
  return createHash('sha256').update(`${visitSalt()}|${ip}`).digest('hex')
}

/** 记一次访问；同一 IP 当天重复调用会被唯一约束挡掉，不会产生第二行 */
export function recordVisit(ip: string): void {
  // 兼容 IPv4 映射写法 ::ffff:1.2.3.4，否则同一台机器会算出两个哈希
  const value = ip.replace(/^::ffff:/, '').trim() || 'unknown'
  const db = useDb()
  const hash = hashIp(value)
  db.prepare('INSERT OR IGNORE INTO visit_log (ip_hash, day) VALUES (?, ?)').run(hash, localDay())
  // 累计集合只随「新访客」增长，不受明细清理影响
  db.prepare('INSERT OR IGNORE INTO visit_visitor (ip_hash) VALUES (?)').run(hash)
}

export interface VisitDay {
  day: string
  count: number
}

export interface VisitStats {
  /** 历史累计唯一访客（同一 IP 跨天只算一次） */
  total: number
  /** 近 TREND_DAYS 天的每日唯一访客，按日期升序，缺失的日期补 0 */
  days: VisitDay[]
  /** 今天，供前端高亮当天柱子 */
  today: string
}

export function visitStats(): VisitStats {
  const db = useDb()

  // 明细只服务趋势：按 day 索引删掉保留期之外的行，代价极低
  const cutoff = localDay(new Date(Date.now() - KEEP_DAYS * 86400000))
  db.prepare('DELETE FROM visit_log WHERE day < ?').run(cutoff)

  // 累计口径来自独立集合，与上面的清理互不影响
  const total = (db.prepare('SELECT COUNT(*) AS n FROM visit_visitor').get() as { n: number }).n

  const today = new Date()
  const days: string[] = []
  for (let i = TREND_DAYS - 1; i >= 0; i--) {
    days.push(localDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)))
  }

  const rows = db
    .prepare(
      `SELECT day, COUNT(*) AS n FROM visit_log
       WHERE day IN (${days.map(() => '?').join(',')}) GROUP BY day`,
    )
    .all(...days) as { day: string; n: number }[]
  const byDay = new Map(rows.map((r) => [r.day, r.n]))

  return {
    total,
    days: days.map((day) => ({ day, count: byDay.get(day) ?? 0 })),
    today: localDay(today),
  }
}