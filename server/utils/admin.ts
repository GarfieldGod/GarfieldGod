// 后台写操作服务层：文章增删改、评论审核、页面与站点信息维护。
// 只读查询沿用 content.ts，这里只负责「会改数据」的部分。
import { createError } from 'h3'
import { useDb } from './db'
import { normalizeMediaSrc } from '../../utils/media'
import { attachPages, normalizePostStyleOptions, type PostDTO, type PostRow } from './content'
import {
  PAGE_LAYOUTS,
  CARD_TYPES,
  CONTENT_SOURCES,
  DATE_POSITIONS,
  ASPECT_RATIOS,
  listNavPages,
  listPageTags,
  toNavPageDTO,
  resolvePagePosts,
  type NavPageDTO,
  type NavPageRow,
} from './navPages'

export const POST_STATUSES = ['draft', 'published'] as const
export const POST_FORMATS = ['markdown', 'html'] as const
// 正文宽度挡位；'' 表示「默认」，跟随模板宽度
export const POST_CONTENT_WIDTHS = ['wide', 'normal', 'narrow'] as const
// 文章样式方案；'' 表示「默认」，即经典居中单栏
export const POST_STYLES = ['classic', 'toc', 'magazine', 'cards', 'link'] as const
export const COMMENT_STATUSES = ['approved', 'hidden'] as const

export interface AdminPost extends PostDTO {
  views: number
  commentCount: number
}

export interface AdminComment {
  id: number
  post: number
  postTitle: string
  author: string
  authorEmail: string | null
  content: string
  date: string
  status: string
}

export interface PostInput {
  title: string
  date: string
  content: string
  excerpt?: string
  featured?: string | null
  pageIds?: number[]
  tagIds?: number[]
  status?: string
  format?: string
  contentWidth?: string
  postStyle?: string
  postStyleOptions?: unknown
  /** 是否允许留言；缺省视为允许 */
  allowComments?: boolean
  /** 背景音乐：歌单里某一首的音频地址，空串表示没有 */
  bgmSrc?: string
}

function normalizeTagIds(tags: unknown): number[] {
  if (!Array.isArray(tags)) return []
  return [...new Set(tags.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 20)
}

export function normalizeStatus(value: unknown): string {
  return POST_STATUSES.includes(value as any) ? String(value) : 'published'
}

export function normalizeFormat(value: unknown): string {
  return POST_FORMATS.includes(value as any) ? String(value) : 'markdown'
}

export function normalizeContentWidth(value: unknown): string {
  return POST_CONTENT_WIDTHS.includes(value as any) ? String(value) : ''
}

export function normalizePostStyle(value: unknown): string {
  return POST_STYLES.includes(value as any) ? String(value) : ''
}

/** 背景音乐只存音频地址；长度与站点歌单的地址上限保持一致 */
export function normalizeBgmSrc(value: unknown): string {
  // 顺手补齐站内地址开头漏掉的斜杠：否则前台按相对当前文章解析，音频必然加载失败
  return typeof value === 'string' ? normalizeMediaSrc(value.slice(0, 500)) : ''
}

export function parsePostInput(body: any): PostInput {
  const title = String(body?.title ?? '').trim().slice(0, 200)
  if (!title) throw createError({ statusCode: 400, message: '请填写标题' })

  const format = normalizeFormat(body?.format)
  const content = String(body?.content ?? '')
  const date = String(body?.date ?? '').trim() || new Date().toISOString()
  if (Number.isNaN(Date.parse(date))) {
    throw createError({ statusCode: 400, message: '日期格式不正确' })
  }

  const rawPageIds = Array.isArray(body?.pageIds) ? body.pageIds.map(Number) : []
  if (rawPageIds.some((n: number) => !Number.isInteger(n))) {
    throw createError({ statusCode: 400, message: '展示页面参数不正确' })
  }

  const featured = String(body?.featured ?? '').trim()

  return {
    title,
    date,
    content,
    excerpt: String(body?.excerpt ?? '').trim(),
    featured: featured || null,
    pageIds: rawPageIds,
    tagIds: normalizeTagIds(body?.tagIds),
    status: normalizeStatus(body?.status),
    format,
    contentWidth: normalizeContentWidth(body?.contentWidth),
    postStyle: normalizePostStyle(body?.postStyle),
    postStyleOptions: normalizePostStyleOptions(body?.postStyleOptions),
    // 与 navVisible 同样的写法：缺省即「允许」，只有明确传 false 才关掉
    allowComments: body?.allowComments !== false,
    bgmSrc: normalizeBgmSrc(body?.bgmSrc),
  }
}

// 摘要缺省时从正文推断，便于列表页和 SEO 使用
export function deriveExcerpt(content: string, format: string): string {
  const plain =
    format === 'markdown'
      ? content
          .replace(/```[\s\S]*?```/g, ' ')
          .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
          .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
          .replace(/[#>*_`~-]/g, ' ')
      : content.replace(/<[^>]*>/g, ' ')
  return plain.replace(/\s+/g, ' ').trim().slice(0, 160)
}

function decorate(rows: PostRow[]): AdminPost[] {
  const posts = attachPages(rows) as AdminPost[]
  const db = useDb()
  const views = db.prepare('SELECT post_id, views FROM post_views').all() as {
    post_id: number
    views: number
  }[]
  const counts = db
    .prepare('SELECT post, COUNT(*) AS n FROM comments GROUP BY post')
    .all() as { post: number; n: number }[]
  const viewMap = new Map(views.map((v) => [v.post_id, v.views]))
  const countMap = new Map(counts.map((c) => [c.post, c.n]))
  return rows.map((row, i) => ({
    ...posts[i],
    views: viewMap.get(row.id) ?? 0,
    commentCount: countMap.get(row.id) ?? 0,
  }))
}

export function listPostsForAdmin(): AdminPost[] {
  const rows = useDb()
    .prepare("SELECT * FROM posts ORDER BY CASE status WHEN 'draft' THEN 0 ELSE 1 END, datetime(date) DESC")
    .all() as PostRow[]
  return decorate(rows)
}

export function getPostForAdmin(id: number): AdminPost | null {
  const row = useDb().prepare('SELECT * FROM posts WHERE id = ?').get(id) as PostRow | undefined
  if (!row) return null
  return decorate([row])[0]
}

function setPostPages(postId: number, pageIds: number[]) {
  const db = useDb()
  db.prepare('DELETE FROM post_pages WHERE post_id = ?').run(postId)
  const insert = db.prepare('INSERT OR IGNORE INTO post_pages (post_id, page_id) VALUES (?, ?)')
  for (const pageId of pageIds) insert.run(postId, pageId)
}

// 标签由页面持有，写入前必须校验归属，防止把标签挂错页面
function assertTagsOwned(tagIds: number[], pageIds: number[]) {
  if (!tagIds.length || !pageIds.length) return
  const rows = useDb()
    .prepare(`SELECT id, page_id FROM tags WHERE id IN (${tagIds.map(() => '?').join(',')})`)
    .all(...tagIds) as { id: number; page_id: number }[]
  const allowed = new Set(pageIds)
  for (const t of rows) {
    if (!allowed.has(t.page_id)) {
      throw createError({ statusCode: 400, message: `标签 ${t.id} 不属于所选展示页面，请先取消勾选` })
    }
  }
  // 未知 id 全部拒掉，避免把已删除页面的标签偷偷写进来
  if (rows.length !== tagIds.length) {
    throw createError({ statusCode: 400, message: '包含不存在的标签' })
  }
}

function setPostTags(postId: number, tagIds: number[]) {
  const db = useDb()
  db.prepare('DELETE FROM post_tags WHERE post_id = ?').run(postId)
  const insert = db.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)')
  for (const tagId of tagIds) insert.run(postId, tagId)
}

function assertPagesExist(pageIds: number[]) {
  if (!pageIds.length) return
  const valid = new Set(
    (useDb().prepare('SELECT id FROM nav_pages').all() as { id: number }[]).map((p) => p.id),
  )
  for (const id of pageIds) {
    if (!valid.has(id)) throw createError({ statusCode: 400, message: `展示页面 ${id} 不存在` })
  }
}

export function createPost(input: PostInput): AdminPost {
  const db = useDb()
  const format = normalizeFormat(input.format)
  const status = normalizeStatus(input.status)
  const contentWidth = normalizeContentWidth(input.contentWidth)
  const postStyle = normalizePostStyle(input.postStyle)
  const postStyleOptions = JSON.stringify(normalizePostStyleOptions(input.postStyleOptions))
  const pageIds = Array.isArray(input.pageIds) ? [...new Set(input.pageIds.map(Number))] : []
  const tagIds = input.tagIds ?? []
  assertPagesExist(pageIds)
  assertTagsOwned(tagIds, pageIds)

  const excerpt = input.excerpt?.trim() || deriveExcerpt(input.content, format)
  const now = new Date().toISOString()

  db.exec('BEGIN')
  try {
    const info = db
      .prepare(
        `INSERT INTO posts (slug, title, date, modified, link, content, excerpt, featured, status, format, content_width, post_style, post_style_options, allow_comments, bgm_src)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        null,
        input.title,
        input.date || now,
        now,
        null,
        input.content,
        excerpt,
        input.featured ?? null,
        status,
        format,
        contentWidth,
        postStyle,
        postStyleOptions,
        input.allowComments === false ? 0 : 1,
        normalizeBgmSrc(input.bgmSrc),
      )
    const id = Number(info.lastInsertRowid)
    setPostPages(id, pageIds)
    setPostTags(id, tagIds)
    db.exec('COMMIT')
    return getPostForAdmin(id)!
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function updatePost(id: number, input: PostInput): AdminPost | null {
  const db = useDb()
  if (!db.prepare('SELECT id FROM posts WHERE id = ?').get(id)) return null

  const format = normalizeFormat(input.format)
  const status = normalizeStatus(input.status)
  const contentWidth = normalizeContentWidth(input.contentWidth)
  const postStyle = normalizePostStyle(input.postStyle)
  const postStyleOptions = JSON.stringify(normalizePostStyleOptions(input.postStyleOptions))
  const pageIds = Array.isArray(input.pageIds) ? [...new Set(input.pageIds.map(Number))] : []
  const tagIds = input.tagIds ?? []
  assertPagesExist(pageIds)
  assertTagsOwned(tagIds, pageIds)

  const excerpt = input.excerpt?.trim() || deriveExcerpt(input.content, format)

  db.exec('BEGIN')
  try {
    db.prepare(
      `UPDATE posts SET title = ?, date = ?, modified = ?, content = ?, excerpt = ?, featured = ?,
                        status = ?, format = ?, content_width = ?, post_style = ?, post_style_options = ?,
                        allow_comments = ?, bgm_src = ? WHERE id = ?`,
    ).run(
      input.title,
      input.date,
      new Date().toISOString(),
      input.content,
      excerpt,
      input.featured ?? null,
      status,
      format,
      contentWidth,
      postStyle,
      postStyleOptions,
      input.allowComments === false ? 0 : 1,
      normalizeBgmSrc(input.bgmSrc),
      id,
    )
    setPostPages(id, pageIds)
    setPostTags(id, tagIds)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return getPostForAdmin(id)
}

export function deletePost(id: number): boolean {
  const db = useDb()
  if (!db.prepare('SELECT id FROM posts WHERE id = ?').get(id)) return false
  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM post_pages WHERE post_id = ?').run(id)
    db.prepare('DELETE FROM post_tags WHERE post_id = ?').run(id)
    db.prepare('DELETE FROM comments WHERE post = ?').run(id)
    db.prepare('DELETE FROM post_views WHERE post_id = ?').run(id)
    db.prepare('DELETE FROM posts WHERE id = ?').run(id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return true
}

export function listCommentsForAdmin(): AdminComment[] {
  const rows = useDb()
    .prepare(
      `SELECT c.id, c.post, c.author, c.author_email, c.content, c.date, c.status,
              COALESCE(p.title, '（文章已删除）') AS post_title
       FROM comments c LEFT JOIN posts p ON p.id = c.post
       ORDER BY datetime(c.date) DESC`,
    )
    .all() as {
    id: number
    post: number
    author: string
    author_email: string | null
    content: string
    date: string
    status: string
    post_title: string
  }[]

  return rows.map((r) => ({
    id: r.id,
    post: r.post,
    postTitle: r.post_title,
    author: r.author,
    authorEmail: r.author_email,
    content: r.content,
    date: r.date,
    status: r.status,
  }))
}

export function setCommentStatus(id: number, status: string): boolean {
  if (!COMMENT_STATUSES.includes(status as any)) throw new Error('无效的评论状态')
  const info = useDb().prepare('UPDATE comments SET status = ? WHERE id = ?').run(status, id)
  return info.changes > 0
}

export function deleteComment(id: number): boolean {
  return useDb().prepare('DELETE FROM comments WHERE id = ?').run(id).changes > 0
}

/**
 * 站点信息出口统一规范化歌单地址。
 * 老数据里可能存着漏掉开头斜杠的写法（uploads/...），前台直接拿去当音频 src 会被
 * 解析成「相对当前文章」的路径而 404；写入口已经会补，这里兜住历史数据与所有读取方。
 */
export function withNormalizedPlaylist(meta: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(meta.playlist)) return meta
  return {
    ...meta,
    playlist: meta.playlist.map((track) => {
      if (!track || typeof track !== 'object') return track
      const t = track as Record<string, unknown>
      return typeof t.src === 'string' ? { ...t, src: normalizeMediaSrc(t.src) } : track
    }),
  }
}

export function getSiteMeta(): Record<string, unknown> {
  const row = useDb().prepare("SELECT value FROM site_meta WHERE key = 'site'").get() as
    | { value: string }
    | undefined
  if (!row) return {}
  try {
    return withNormalizedPlaylist(JSON.parse(row.value))
  } catch {
    return {}
  }
}

export function updateSiteMeta(patch: Record<string, unknown>): Record<string, unknown> {
  const next = { ...getSiteMeta(), ...patch }
  useDb()
    .prepare("INSERT INTO site_meta (key, value) VALUES ('site', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify(next))
  return next
}

export function adminStats() {
  const db = useDb()
  const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n
  return {
    posts: one("SELECT COUNT(*) AS n FROM posts WHERE status = 'published'"),
    drafts: one("SELECT COUNT(*) AS n FROM posts WHERE status = 'draft'"),
    comments: one('SELECT COUNT(*) AS n FROM comments'),
    hiddenComments: one("SELECT COUNT(*) AS n FROM comments WHERE status = 'hidden'"),
    views: one('SELECT COALESCE(SUM(views), 0) AS n FROM post_views'),
    pages: one('SELECT COUNT(*) AS n FROM nav_pages'),
  }
}

// ===== 页面（nav_pages）后台维护 =====

// 这些顶层路径已被真实路由占用，页面 slug 不能撞上去
const RESERVED_ROUTE_PREFIXES = ['admin', 'post', 'api', 'media', 'uploads', '_nuxt']
const SLUG_PATTERN = /^[a-z0-9][a-z0-9\-_/]*$/

export interface NavPageInput {
  slug: string
  title: string
  parentId: number
  sortOrder: number
  navVisible: boolean
  layout: string
  cardType: string
  columns: number
  pageSize: number
  itemFields: Record<string, boolean>
  contentSource: string
  aggregatePages: number[]
  latestLimit: number
  showCover: boolean
  coverImage: string | null
  tagFilter: boolean
  /** 「子页面」展示类型：总览里是否显示「共 N 篇 / 查看全部」 */
  showChildDetail: boolean
  content: string
  tagNames: string[]
  datePosition: string
  aspectRatio: string
}

export interface AdminNavPage extends NavPageDTO {
  postCount: number
  childCount: number
  tagNames: string[]
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T, label: string): T {
  if (value == null || value === '') return fallback
  if (!allowed.includes(value as T)) throw createError({ statusCode: 400, message: `${label}取值不合法` })
  return value as T
}

function pickInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(Math.round(n), min), max)
}

function normalizePageSlug(raw: unknown): string {
  const slug = String(raw ?? '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/')
    .toLowerCase()
  if (!slug) throw createError({ statusCode: 400, message: '请填写页面路径' })
  if (!SLUG_PATTERN.test(slug)) {
    throw createError({ statusCode: 400, message: '路径只能包含小写字母、数字、连字符、下划线与斜杠' })
  }
  const head = slug.split('/')[0]
  if (RESERVED_ROUTE_PREFIXES.includes(head)) {
    throw createError({ statusCode: 400, message: `路径不能以 ${head} 开头，该前缀已被系统占用` })
  }
  return slug
}

// 父页面必须存在，且不能是自身或自身的后代（否则页面树成环，导航会无限递归）
function assertParent(parentId: number, selfId: number | null) {
  if (parentId === 0) return
  if (selfId != null && parentId === selfId) {
    throw createError({ statusCode: 400, message: '父页面不能是页面自身' })
  }
  const db = useDb()
  const seen = new Set<number>()
  let cursor = parentId
  while (cursor !== 0) {
    if (selfId != null && cursor === selfId) {
      throw createError({ statusCode: 400, message: '父页面不能是页面自身的子页面' })
    }
    if (seen.has(cursor)) throw createError({ statusCode: 400, message: '页面层级存在循环' })
    seen.add(cursor)
    const row = db.prepare('SELECT parent_id FROM nav_pages WHERE id = ?').get(cursor) as
      | { parent_id: number }
      | undefined
    if (!row) throw createError({ statusCode: 400, message: '父页面不存在' })
    cursor = row.parent_id
  }
}

function assertSlugFree(slug: string, exceptId?: number) {
  const row = useDb().prepare('SELECT id FROM nav_pages WHERE slug = ?').get(slug) as { id: number } | undefined
  if (row && row.id !== exceptId) {
    throw createError({ statusCode: 400, message: `路径 ${slug} 已被其它页面占用` })
  }
}

function assertAggregatePages(pageIds: number[], selfId: number | null) {
  if (!pageIds.length) return
  const valid = new Set(
    (useDb().prepare('SELECT id FROM nav_pages').all() as { id: number }[]).map((p) => p.id),
  )
  for (const id of pageIds) {
    if (!valid.has(id)) throw createError({ statusCode: 400, message: `页面 ${id} 不存在` })
    if (selfId != null && id === selfId) {
      throw createError({ statusCode: 400, message: '聚合页面不能包含页面自身' })
    }
  }
}

// 页面持有的标签：顺序即筛选面板顺序，名称相同则沿用原记录以保住文章上的引用
function setPageTags(pageId: number, tagNames: string[]) {
  const db = useDb()
  const upsert = db.prepare(
    'INSERT INTO tags (name, page_id, sort_order) VALUES (?, ?, ?) ON CONFLICT(name, page_id) DO UPDATE SET sort_order = excluded.sort_order',
  )
  const getTag = db.prepare('SELECT id FROM tags WHERE name = ? AND page_id = ?')
  const keep = new Set<number>()
  normalizeTagNames(tagNames).forEach((name, i) => {
    upsert.run(name, pageId, i)
    const row = getTag.get(name, pageId) as { id: number } | undefined
    if (row) keep.add(row.id)
  })

  // 页面已不再持有的标签：连同文章引用一并清理，这些文章相当于改回「未分类」
  const delRef = db.prepare('DELETE FROM post_tags WHERE tag_id = ?')
  const delTag = db.prepare('DELETE FROM tags WHERE id = ?')
  for (const t of db.prepare('SELECT id FROM tags WHERE page_id = ?').all(pageId) as { id: number }[]) {
    if (keep.has(t.id)) continue
    delRef.run(t.id)
    delTag.run(t.id)
  }
}

function normalizeTagNames(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  return [...new Set(tags.map((t) => String(t).trim()).filter(Boolean))].slice(0, 30)
}

export function parseNavPageInput(body: any, existing?: NavPageRow | null): NavPageInput {
  const title = String(body?.title ?? '').trim().slice(0, 100)
  if (!title) throw createError({ statusCode: 400, message: '请填写页面标题' })

  // 保留页面的路径不可改，避免把首页/关于这类固定入口改坏
  const slug = existing?.reserved ? existing.slug : normalizePageSlug(body?.slug)

  const itemFields: Record<string, boolean> = {}
  if (body?.itemFields && typeof body.itemFields === 'object') {
    for (const [key, value] of Object.entries(body.itemFields)) itemFields[key] = !!value
  }

  return {
    slug,
    title,
    parentId: pickInt(body?.parentId, 0, Number.MAX_SAFE_INTEGER, 0),
    sortOrder: pickInt(body?.sortOrder, 0, 9999, 0),
    navVisible: body?.navVisible !== false,
    layout: pickEnum(body?.layout, PAGE_LAYOUTS, 'items', '展示类型'),
    cardType: pickEnum(body?.cardType, CARD_TYPES, 'standard', '条目类型'),
    columns: pickInt(body?.columns, 1, 4, 1),
    pageSize: pickInt(body?.pageSize, 1, 100, 10),
    itemFields,
    contentSource: pickEnum(body?.contentSource, CONTENT_SOURCES, 'posts', '内容来源'),
    aggregatePages: Array.isArray(body?.aggregatePages)
      ? [...new Set(body.aggregatePages.map(Number).filter((n: number) => Number.isInteger(n) && n > 0))]
      : [],
    latestLimit: pickInt(body?.latestLimit, 0, 50, 10),
    showCover: !!body?.showCover,
    coverImage: String(body?.coverImage ?? '').trim() || null,
    tagFilter: !!body?.tagFilter,
    // 与 navVisible 同样的写法：缺省即「显示」，只有明确传 false 才关掉
    showChildDetail: body?.showChildDetail !== false,
    content: String(body?.content ?? ''),
    tagNames: normalizeTagNames(body?.tagNames),
    datePosition: pickEnum(body?.datePosition, DATE_POSITIONS, 'inline', '日期位置'),
    aspectRatio: pickEnum(body?.aspectRatio, ASPECT_RATIOS, '', '卡片宽高比'),
  }
}

function decorateNavPage(page: NavPageDTO): AdminNavPage {
  const db = useDb()
  const { n: childCount } = db
    .prepare('SELECT COUNT(*) AS n FROM nav_pages WHERE parent_id = ?')
    .get(page.id) as { n: number }
  return {
    ...page,
    postCount: resolvePagePosts(page).length,
    childCount,
    tagNames: listPageTags(page.id).map((t) => t.name),
  }
}

export function listNavPagesForAdmin(): AdminNavPage[] {
  return listNavPages().map(decorateNavPage)
}

export function getNavPageForAdmin(id: number): AdminNavPage | null {
  const row = useDb().prepare('SELECT * FROM nav_pages WHERE id = ?').get(id) as NavPageRow | undefined
  return row ? decorateNavPage(toNavPageDTO(row)) : null
}

export function createNavPage(body: any): AdminNavPage {
  const db = useDb()
  const input = parseNavPageInput(body)
  assertSlugFree(input.slug)
  assertParent(input.parentId, null)
  assertAggregatePages(input.aggregatePages, null)

  db.exec('BEGIN')
  try {
    const info = db
      .prepare(
        `INSERT INTO nav_pages
           (slug, title, parent_id, sort_order, nav_visible, layout, card_type, columns, page_size, item_fields,
            content_source, aggregate_pages, latest_limit, show_cover, cover_image,
            is_home, tag_filter, show_child_detail, content, reserved, date_position, aspect_ratio)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, ?, ?)`,
      )
      .run(
        input.slug,
        input.title,
        input.parentId,
        input.sortOrder,
        input.navVisible ? 1 : 0,
        input.layout,
        input.cardType,
        input.columns,
        input.pageSize,
        JSON.stringify(input.itemFields),
        input.contentSource,
        JSON.stringify(input.aggregatePages),
        input.latestLimit,
        input.showCover ? 1 : 0,
        input.coverImage,
        input.tagFilter ? 1 : 0,
        input.showChildDetail ? 1 : 0,
        input.content,
        input.datePosition,
        input.aspectRatio,
      )
    const id = Number(info.lastInsertRowid)
    setPageTags(id, input.tagNames)
    db.exec('COMMIT')
    return getNavPageForAdmin(id)!
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function updateNavPage(id: number, body: any): AdminNavPage | null {
  const db = useDb()
  const existing = db.prepare('SELECT * FROM nav_pages WHERE id = ?').get(id) as NavPageRow | undefined
  if (!existing) return null

  const input = parseNavPageInput(body, existing)
  assertSlugFree(input.slug, id)
  assertParent(input.parentId, id)
  assertAggregatePages(input.aggregatePages, id)

  db.exec('BEGIN')
  try {
    db.prepare(
      `UPDATE nav_pages SET slug = ?, title = ?, parent_id = ?, sort_order = ?, nav_visible = ?,
         layout = ?, card_type = ?, columns = ?, page_size = ?, item_fields = ?, content_source = ?,
         aggregate_pages = ?, latest_limit = ?, show_cover = ?, cover_image = ?,
         tag_filter = ?, show_child_detail = ?, content = ?, date_position = ?, aspect_ratio = ? WHERE id = ?`,
    ).run(
      input.slug,
      input.title,
      input.parentId,
      input.sortOrder,
      input.navVisible ? 1 : 0,
      input.layout,
      input.cardType,
      input.columns,
      input.pageSize,
      JSON.stringify(input.itemFields),
      input.contentSource,
      JSON.stringify(input.aggregatePages),
      input.latestLimit,
      input.showCover ? 1 : 0,
      input.coverImage,
      input.tagFilter ? 1 : 0,
      input.showChildDetail ? 1 : 0,
      input.content,
      input.datePosition,
      input.aspectRatio,
      id,
    )
    setPageTags(id, input.tagNames)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return getNavPageForAdmin(id)
}

// 删除保护：保留页/首页不可删；有子页面或有文章的页面必须先清空
export function deleteNavPage(id: number): boolean {
  const db = useDb()
  const existing = db.prepare('SELECT * FROM nav_pages WHERE id = ?').get(id) as NavPageRow | undefined
  if (!existing) return false
  if (existing.reserved) throw createError({ statusCode: 400, message: '该页面为系统保留页，不能删除' })
  if (existing.is_home) throw createError({ statusCode: 400, message: '首页不能删除' })

  const { n: childCount } = db
    .prepare('SELECT COUNT(*) AS n FROM nav_pages WHERE parent_id = ?')
    .get(id) as { n: number }
  if (childCount > 0) {
    throw createError({ statusCode: 400, message: `该页面下还有 ${childCount} 个子页面，请先删除或移走它们` })
  }

  const { n: postCount } = db
    .prepare('SELECT COUNT(*) AS n FROM post_pages WHERE page_id = ?')
    .get(id) as { n: number }
  if (postCount > 0) {
    throw createError({ statusCode: 400, message: `该页面还有 ${postCount} 篇文章，请先移走或删除这些文章` })
  }

  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM tags WHERE page_id = ?').run(id)
    db.prepare('DELETE FROM nav_pages WHERE id = ?').run(id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return true
}