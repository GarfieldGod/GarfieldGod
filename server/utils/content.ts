import { useDb } from './db'

export interface PostRow {
  id: number
  slug: string | null
  title: string
  date: string
  modified: string | null
  link: string | null
  content: string | null
  excerpt: string | null
  featured: string | null
  status: string
  format: string
  content_width: string
  post_style: string
  post_style_options: string
  allow_comments: number
}

/** 文章样式方案的附加设置；各方案各取所需，未用到的字段保持默认即可 */
export interface PostStyleOptions {
  /** 左文右栏：目录栏靠右还是靠左 */
  tocSide: 'right' | 'left'
  /** 左文右栏：是否显示阅读进度 */
  tocProgress: boolean
  /** 杂志大图：头图地址，留空时用渐变占位 */
  heroImage: string
  /** 杂志大图：头图高度挡位 */
  heroSize: 'compact' | 'standard' | 'tall'
  /** 分节卡片：是否显示顶部迷你导航 */
  miniNav: boolean
  /** 分节卡片：是否显示「第 N 节」小节编号 */
  sectionNumbers: boolean
  /** 超链接：跳转目标地址；留空则该方案按普通文章显示，不白屏 */
  linkUrl: string
  /** 超链接：自动跳转前的等待秒数，0 表示不自动跳、只留「立即前往」按钮 */
  linkDelay: number
}

export const POST_STYLE_OPTION_DEFAULTS: PostStyleOptions = {
  tocSide: 'right',
  tocProgress: true,
  heroImage: '',
  heroSize: 'standard',
  miniNav: true,
  sectionNumbers: true,
  linkUrl: '',
  // 与 utils/postStyle.ts 的 LINK_DELAY_DEFAULT 保持一致
  linkDelay: 2,
}

export function normalizePostStyleOptions(value: unknown): PostStyleOptions {
  const o = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  return {
    tocSide: o.tocSide === 'left' ? 'left' : 'right',
    tocProgress: o.tocProgress !== false,
    heroImage: typeof o.heroImage === 'string' ? o.heroImage.trim().slice(0, 500) : '',
    heroSize: o.heroSize === 'compact' || o.heroSize === 'tall' ? o.heroSize : 'standard',
    miniNav: o.miniNav !== false,
    sectionNumbers: o.sectionNumbers !== false,
    linkUrl: typeof o.linkUrl === 'string' ? o.linkUrl.trim().slice(0, 500) : '',
    linkDelay:
      typeof o.linkDelay === 'number' && Number.isFinite(o.linkDelay)
        ? Math.min(30, Math.max(0, Math.floor(o.linkDelay)))
        : POST_STYLE_OPTION_DEFAULTS.linkDelay,
  }
}

/** 旧库/新文章的都可能是空串，空串一律回落到默认设置 */
export function parsePostStyleOptions(raw: string | null | undefined): PostStyleOptions {
  if (!raw) return { ...POST_STYLE_OPTION_DEFAULTS }
  try {
    return normalizePostStyleOptions(JSON.parse(raw))
  } catch {
    return { ...POST_STYLE_OPTION_DEFAULTS }
  }
}

/** 文章所在的展示页面，详情页与条目胶囊都用它 */
export interface PageRefDTO {
  id: number
  title: string
  slug: string
  path: string
  /** 首页标记：前台始终不把首页作为「所属页面」展示 */
  isHome: boolean
}

/** 标签由页面持有，因此带上所属页面 */
export interface TagRefDTO {
  id: number
  name: string
  pageId: number
}

export interface PostDTO {
  id: number
  slug: string
  title: string
  date: string
  modified: string
  link: string
  content: string
  excerpt: string
  featured: string | null
  pages: PageRefDTO[]
  tags: TagRefDTO[]
  status: string
  format: string
  /** 正文宽度挡位：'' 默认 / wide 宽幅 / normal 正常 / narrow 窄幅 */
  contentWidth: string
  /** 文章样式方案：'' 默认（经典居中单栏）/ classic / toc / magazine / cards */
  postStyle: string
  /** 文章样式方案的附加设置 */
  postStyleOptions: PostStyleOptions
  /** 是否允许留言：false 时前台不显示留言面板，接口也会拒收 */
  allowComments: boolean
}

export interface CommentDTO {
  id: number
  post: number
  author: string
  author_email: string | null
  content: string
  date: string
  status: string
}

function toPageRef(row: { id: number; title: string; slug: string; is_home: number }): PageRefDTO {
  return { id: row.id, title: row.title, slug: row.slug, path: `/${row.slug}`, isHome: !!row.is_home }
}

function toPostDTO(row: PostRow, pages: PageRefDTO[], tags: TagRefDTO[]): PostDTO {
  return {
    id: row.id,
    slug: row.slug ?? '',
    title: row.title,
    date: row.date,
    modified: row.modified ?? '',
    link: row.link ?? '',
    content: row.content ?? '',
    excerpt: row.excerpt ?? '',
    featured: row.featured ?? null,
    pages,
    tags,
    status: row.status ?? 'published',
    format: row.format ?? 'html',
    contentWidth: row.content_width ?? '',
    postStyle: row.post_style ?? '',
    postStyleOptions: parsePostStyleOptions(row.post_style_options),
    // 老库补列前读到的可能是 undefined，一律按「允许留言」处理，与默认值一致
    allowComments: row.allow_comments !== 0,
  }
}

export function attachPages(rows: PostRow[]): PostDTO[] {
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const placeholders = ids.map(() => '?').join(',')
  const db = useDb()

  // 页面按页面树顺序返回，条目胶囊据此取第一个命中的页面
  const pageRows = db
    .prepare(
      `SELECT pp.post_id AS post_id, p.id AS id, p.title AS title, p.slug AS slug, p.is_home AS is_home
       FROM post_pages pp
       JOIN nav_pages p ON p.id = pp.page_id
       WHERE pp.post_id IN (${placeholders})
       ORDER BY p.parent_id, p.sort_order, p.id`,
    )
    .all(...ids) as { post_id: number; id: number; title: string; slug: string; is_home: number }[]

  const tagRows = db
    .prepare(
      `SELECT pt.post_id AS post_id, t.id AS id, t.name AS name, t.page_id AS page_id
       FROM post_tags pt
       JOIN tags t ON t.id = pt.tag_id
       WHERE pt.post_id IN (${placeholders})
       ORDER BY t.page_id, t.sort_order, t.id`,
    )
    .all(...ids) as { post_id: number; id: number; name: string; page_id: number }[]

  const pagesByPost = new Map<number, PageRefDTO[]>()
  for (const r of pageRows) {
    const list = pagesByPost.get(r.post_id) ?? []
    list.push(toPageRef(r))
    pagesByPost.set(r.post_id, list)
  }
  const tagsByPost = new Map<number, TagRefDTO[]>()
  for (const r of tagRows) {
    const list = tagsByPost.get(r.post_id) ?? []
    list.push({ id: r.id, name: r.name, pageId: r.page_id })
    tagsByPost.set(r.post_id, list)
  }

  return rows.map((r) => toPostDTO(r, pagesByPost.get(r.id) ?? [], tagsByPost.get(r.id) ?? []))
}

export function listPosts(
  opts: {
    limit?: number
    offset?: number
    pageId?: number
    pageIds?: number[]
    includeDrafts?: boolean
  } = {},
): PostDTO[] {
  const params: number[] = []
  const pageIds = opts.pageIds?.length
    ? opts.pageIds
    : opts.pageId != null
      ? [opts.pageId]
      : null

  // 聚合多个页面时同一篇文章可能命中多次，需要去重
  let sql = pageIds ? 'SELECT DISTINCT p.* FROM posts p' : 'SELECT p.* FROM posts p'
  if (pageIds) {
    sql += ` JOIN post_pages pp ON pp.post_id = p.id AND pp.page_id IN (${pageIds.map(() => '?').join(',')})`
    params.push(...pageIds)
  }
  if (!opts.includeDrafts) sql += " WHERE p.status = 'published'"
  sql += ' ORDER BY datetime(p.date) DESC'
  if (opts.limit != null) {
    sql += ' LIMIT ?'
    params.push(opts.limit)
  }
  if (opts.offset != null) {
    sql += ' OFFSET ?'
    params.push(opts.offset)
  }
  return attachPages(useDb().prepare(sql).all(...params) as PostRow[])
}

export function countPosts(
  opts: { pageId?: number; pageIds?: number[]; includeDrafts?: boolean } = {},
): number {
  const db = useDb()
  const pageIds = opts.pageIds?.length
    ? opts.pageIds
    : opts.pageId != null
      ? [opts.pageId]
      : null
  const where = opts.includeDrafts ? '' : " AND p.status = 'published'"

  if (!pageIds) {
    const base = opts.includeDrafts ? '' : " WHERE status = 'published'"
    return (db.prepare(`SELECT COUNT(*) AS n FROM posts${base}`).get() as { n: number }).n
  }
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM (
           SELECT DISTINCT pp.post_id
           FROM post_pages pp
           JOIN posts p ON p.id = pp.post_id
           WHERE pp.page_id IN (${pageIds.map(() => '?').join(',')})${where}
         )`,
      )
      .get(...pageIds) as { n: number }
  ).n
}

export function getPost(id: number, includeDrafts = false): PostDTO | null {
  const sql = includeDrafts
    ? 'SELECT * FROM posts WHERE id = ?'
    : "SELECT * FROM posts WHERE id = ? AND status = 'published'"
  const row = useDb().prepare(sql).get(id) as PostRow | undefined
  if (!row) return null
  return attachPages([row])[0]
}

export function listComments(postId: number, includeHidden = false): CommentDTO[] {
  const where = includeHidden ? '' : " AND status = 'approved'"
  return useDb()
    .prepare(
      `SELECT id, post, author, author_email, content, date, status FROM comments
       WHERE post = ?${where} ORDER BY datetime(date) ASC`,
    )
    .all(postId) as CommentDTO[]
}

export function addComment(input: { post: number; author: string; email?: string; content: string }): CommentDTO {
  const db = useDb()
  const info = db
    .prepare(
      `INSERT INTO comments (post, author, author_email, content, date, status)
       VALUES (?, ?, ?, ?, ?, 'approved')`,
    )
    .run(input.post, input.author, input.email ?? null, input.content, new Date().toISOString())
  return db
    .prepare('SELECT id, post, author, author_email, content, date, status FROM comments WHERE id = ?')
    .get(Number(info.lastInsertRowid)) as CommentDTO
}

export function getViews(postId: number): number {
  const row = useDb().prepare('SELECT views FROM post_views WHERE post_id = ?').get(postId) as
    | { views: number }
    | undefined
  return row?.views ?? 0
}

export function incrementViews(postId: number): number {
  useDb()
    .prepare(
      'INSERT INTO post_views (post_id, views) VALUES (?, 1) ON CONFLICT(post_id) DO UPDATE SET views = views + 1',
    )
    .run(postId)
  return getViews(postId)
}