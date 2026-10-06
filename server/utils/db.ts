import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import siteContent from '../../assets/data/site-content.json'

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS site_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id       INTEGER PRIMARY KEY,
  slug     TEXT,
  title    TEXT NOT NULL,
  date     TEXT NOT NULL,
  modified TEXT,
  link     TEXT,
  content  TEXT,
  excerpt  TEXT,
  featured TEXT,
  status   TEXT NOT NULL DEFAULT 'published',
  format   TEXT NOT NULL DEFAULT 'html',
  content_width TEXT NOT NULL DEFAULT '',
  post_style    TEXT NOT NULL DEFAULT '',
  post_style_options TEXT NOT NULL DEFAULT '{}',
  -- 是否允许留言：关掉后前台不出现留言面板，接口也会拒收
  allow_comments INTEGER NOT NULL DEFAULT 1,
  -- 文章背景音乐：歌单里某一首的音频地址，空串表示没有
  bgm_src TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_posts_date ON posts(date DESC);

CREATE TABLE IF NOT EXISTS pages (
  id      INTEGER PRIMARY KEY,
  slug    TEXT,
  title   TEXT NOT NULL,
  link    TEXT,
  content TEXT,
  excerpt TEXT
);

CREATE TABLE IF NOT EXISTS comments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  post         INTEGER NOT NULL,
  author       TEXT NOT NULL,
  author_email TEXT,
  content      TEXT NOT NULL,
  date         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'approved'
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post);

CREATE TABLE IF NOT EXISTS post_views (
  post_id INTEGER PRIMARY KEY,
  views   INTEGER NOT NULL DEFAULT 0
);

-- 导航页面：导航结构与页面形态都由数据驱动
CREATE TABLE IF NOT EXISTS nav_pages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  parent_id       INTEGER NOT NULL DEFAULT 0,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  nav_visible     INTEGER NOT NULL DEFAULT 1,
  layout          TEXT NOT NULL DEFAULT 'items',
  card_type       TEXT NOT NULL DEFAULT 'standard',
  columns         INTEGER NOT NULL DEFAULT 1,
  page_size       INTEGER NOT NULL DEFAULT 10,
  item_fields     TEXT NOT NULL DEFAULT '{}',
  content_source  TEXT NOT NULL DEFAULT 'posts',
  aggregate_pages TEXT NOT NULL DEFAULT '[]',
  latest_limit    INTEGER NOT NULL DEFAULT 10,
  show_cover      INTEGER NOT NULL DEFAULT 0,
  cover_image     TEXT,
  is_home         INTEGER NOT NULL DEFAULT 0,
  tag_filter      INTEGER NOT NULL DEFAULT 0,
  -- 「子页面」展示类型专用：总览里是否显示子页面详情（共 N 篇 / 查看全部）
  show_child_detail INTEGER NOT NULL DEFAULT 1,
  content         TEXT,
  reserved        INTEGER NOT NULL DEFAULT 0,
  date_position   TEXT NOT NULL DEFAULT 'inline',
  aspect_ratio    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_nav_pages_parent ON nav_pages(parent_id);

-- 文章 ↔ 展示页面：一篇文章可以同时出现在多个页面
CREATE TABLE IF NOT EXISTS post_pages (
  post_id INTEGER NOT NULL,
  page_id INTEGER NOT NULL,
  PRIMARY KEY (post_id, page_id)
);
CREATE INDEX IF NOT EXISTS idx_post_pages_page ON post_pages(page_id);

-- 标签由页面持有：同名标签在不同页面下是两条记录
CREATE TABLE IF NOT EXISTS tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  page_id    INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(name, page_id)
);

-- 文章 ↔ 标签，取代原先 posts.tags 的 JSON 文本
CREATE TABLE IF NOT EXISTS post_tags (
  post_id INTEGER NOT NULL,
  tag_id  INTEGER NOT NULL,
  PRIMARY KEY (post_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_post_tags_tag ON post_tags(tag_id);

-- 访客明细：只存 IP 的加盐哈希，不存明文 IP。
-- day 用「服务器本地自然日」字符串而非时间戳，规避时区换算歧义；
-- (ip_hash, day) 唯一约束本身就是去重器——同一 IP 同一天只有一行，
-- 因此「某天的行数」直接就是当天唯一访客数，统计时无需再 DISTINCT。
-- 该表只服务趋势图，会按保留期清理，因此不承担「累计」口径。
CREATE TABLE IF NOT EXISTS visit_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash TEXT NOT NULL,
  day     TEXT NOT NULL,
  UNIQUE(ip_hash, day)
);
CREATE INDEX IF NOT EXISTS idx_visit_log_day ON visit_log(day);

-- 累计访客集合：每个 IP 一行，只随「新访客」增长。
-- 与 visit_log 分开，是为了让明细能按保留期清理而不影响历史累计数。
CREATE TABLE IF NOT EXISTS visit_visitor (
  ip_hash TEXT PRIMARY KEY
);
`

let conn: DatabaseSync | null = null

export function useDb(): DatabaseSync {
  if (conn) return conn
  const file = process.env.GG_DB_PATH || resolve(process.cwd(), '.data', 'garfieldgod.db')
  mkdirSync(dirname(file), { recursive: true })
  conn = new DatabaseSync(file)
  conn.exec('PRAGMA journal_mode = WAL')
  conn.exec(SCHEMA_SQL)
  migrate(conn)
  seedIfEmpty(conn)
  migratePostTags(conn)
  seedNavPages(conn)
  migratePageModel(conn)
  backfillNavPages(conn)
  backfillCardTypes(conn)
  migrateLayoutModes(conn)
  migrateItemLayout(conn)
  backfillDatePositions(conn)
  // 条目模板已废弃：形态完全由「展示类型」决定，老库把这一列删掉
  dropColumn(conn, 'nav_pages', 'item_template')
  // 页面没有草稿/发布之分：老库把 nav_pages.status 一并删掉
  dropColumn(conn, 'nav_pages', 'status')
  // 访客明细不再记录 created_at（趋势只用 day），老库把这一列删掉
  dropColumn(conn, 'visit_log', 'created_at')
  // 累计口径由「现算 DISTINCT」改为独立集合，老库把历史唯一 IP 灌一次
  backfillVisitVisitors(conn)
  return conn
}

function tableExists(db: DatabaseSync, table: string): boolean {
  return !!db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table)
}

function columnExists(db: DatabaseSync, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(
    (c) => c.name === column,
  )
}

function addColumn(db: DatabaseSync, table: string, column: string, ddl: string) {
  if (columnExists(db, table, column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`)
}

function dropColumn(db: DatabaseSync, table: string, column: string) {
  if (!columnExists(db, table, column)) return
  db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`)
}

function parseJsonArray(raw: string | null): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(Number).filter((n) => Number.isInteger(n)) : []
  } catch {
    return []
  }
}

// CREATE TABLE IF NOT EXISTS 不会给已存在的表补列，老库需要显式迁移
function migrate(db: DatabaseSync) {
  addColumn(db, 'posts', 'status', "TEXT NOT NULL DEFAULT 'published'")
  addColumn(db, 'posts', 'format', "TEXT NOT NULL DEFAULT 'html'")
  // 正文宽度挡位：空串表示「默认」，跟随模板宽度，老文章外观不变
  addColumn(db, 'posts', 'content_width', "TEXT NOT NULL DEFAULT ''")
  // 文章样式方案：空串表示「默认」（经典居中单栏），老文章外观不变
  addColumn(db, 'posts', 'post_style', "TEXT NOT NULL DEFAULT ''")
  // 样式方案的附加设置：各方案各取所需，用 JSON 承载，未用到的字段保持默认
  addColumn(db, 'posts', 'post_style_options', "TEXT NOT NULL DEFAULT '{}'")
  // 是否允许留言：默认允许，老文章补列后行为不变
  addColumn(db, 'posts', 'allow_comments', 'INTEGER NOT NULL DEFAULT 1')
  // 文章背景音乐：默认没有，老文章补列后行为不变
  addColumn(db, 'posts', 'bgm_src', "TEXT NOT NULL DEFAULT ''")
  // 索引依赖 status 列，必须等补列完成后再建
  db.exec('CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status)')

  addColumn(db, 'nav_pages', 'aggregate_pages', "TEXT NOT NULL DEFAULT '[]'")
  // 条目类型：决定条目的卡片外观，与「展示类型」（容器形态）解耦
  addColumn(db, 'nav_pages', 'card_type', "TEXT NOT NULL DEFAULT 'standard'")
  // 每页展示数：条目项容器的翻页大小
  addColumn(db, 'nav_pages', 'page_size', 'INTEGER NOT NULL DEFAULT 10')
  // 日期位置：仅「全图叠加 / 网格卡」勾选了日期时生效
  addColumn(db, 'nav_pages', 'date_position', "TEXT NOT NULL DEFAULT 'inline'")
  // 卡片宽高比：空串表示不设置，沿用条目类型自带的比例，故老库补列后外观不变
  addColumn(db, 'nav_pages', 'aspect_ratio', "TEXT NOT NULL DEFAULT ''")
  // 子页面总览里的「共 N 篇 / 查看全部」：默认开，老库补列后外观不变
  addColumn(db, 'nav_pages', 'show_child_detail', 'INTEGER NOT NULL DEFAULT 1')
  addColumn(db, 'tags', 'page_id', 'INTEGER NOT NULL DEFAULT 0')
  addColumn(db, 'tags', 'sort_order', 'INTEGER NOT NULL DEFAULT 0')
  // 同样依赖上面补的 page_id 列
  db.exec('CREATE INDEX IF NOT EXISTS idx_tags_page ON tags(page_id)')
}

// 首次启动时用打包的数据集建库；已有数据则跳过（迁移只在空库时执行一次）
function seedIfEmpty(db: DatabaseSync) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM posts').get() as { n: number }
  if (n > 0) return

  const data = siteContent as any
  db.exec('BEGIN')
  try {
    db.prepare('INSERT OR REPLACE INTO site_meta (key, value) VALUES (?, ?)').run(
      'site',
      JSON.stringify(data.meta ?? {}),
    )

    const insPost = db.prepare(
      `INSERT OR REPLACE INTO posts (id, slug, title, date, modified, link, content, excerpt, featured)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const insView = db.prepare('INSERT OR IGNORE INTO post_views (post_id, views) VALUES (?, 0)')
    for (const p of data.posts ?? []) {
      insPost.run(
        p.id,
        p.slug ?? null,
        p.title ?? '',
        p.date,
        p.modified ?? null,
        p.link ?? null,
        p.content ?? '',
        p.excerpt ?? '',
        p.featured ?? null,
      )
      insView.run(p.id)
    }

    const insPage = db.prepare(
      'INSERT OR REPLACE INTO pages (id, slug, title, link, content, excerpt) VALUES (?, ?, ?, ?, ?, ?)',
    )
    for (const pg of data.pages ?? []) {
      insPage.run(pg.id, pg.slug ?? null, pg.title ?? '', pg.link ?? null, pg.content ?? '', pg.excerpt ?? '')
    }

    const insComment = db.prepare(
      `INSERT OR REPLACE INTO comments (id, post, author, author_email, content, date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const c of data.comments ?? []) {
      insComment.run(c.id, c.post, c.author ?? '', c.author_email ?? null, c.content ?? '', c.date, c.status ?? 'approved')
    }

    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

// 各条目类型的默认显示字段。条目类型只决定卡片外观，字段勾选框只决定卡片里
// 显示哪些内容，二者互不影响；页面可在后台用 item_fields 逐项覆盖。
const DEFAULT_ITEM_FIELDS: Record<string, boolean> = {
  cover: true,
  title: true,
  excerpt: true,
  date: true,
  categoryPill: true,
}
const ITEM_FIELD_DEFAULTS: Record<string, Record<string, boolean>> = {
  standard: { ...DEFAULT_ITEM_FIELDS },
  overlay: { ...DEFAULT_ITEM_FIELDS },
  horizontal: { ...DEFAULT_ITEM_FIELDS },
  editorial: { ...DEFAULT_ITEM_FIELDS },
  mosaic: { ...DEFAULT_ITEM_FIELDS },
}

// 学习笔记筛选面板的标签，顺序即面板顺序
const NOTES_TAG_SEED = ['C++', 'C#', 'Unity', '算法']

interface NavPageSeed {
  slug: string
  title: string
  parentSlug?: string
  sort: number
  layout: string
  /** 条目类型：卡片外观，与容器形态（layout）解耦 */
  cardType?: string
  columns?: number
  source: string
  latestLimit?: number
  showCover?: boolean
  coverImage?: string
  itemFields?: Record<string, boolean>
  isHome?: boolean
  tagFilter?: boolean
  reserved?: boolean
  /** 静态正文取自 WordPress 静态页面（按标题匹配），用于迁移「关于」这类既有内容 */
  contentFromWpPage?: string
}

// 首页封面与原站一致（内置素材放在媒体库根目录，路径稳定）
const HOME_COVER = '/uploads/library/605-1686742077-1.jpg'

// 首次启动时把现有 9 个页面写进 nav_pages，配置与改造前逐页对齐
const NAV_PAGE_SEED: NavPageSeed[] = [
  { slug: 'home', title: '首页', sort: 1, layout: 'items', cardType: 'overlay', columns: 1,
    source: 'latest', latestLimit: 6, showCover: true, coverImage: HOME_COVER, isHome: true, reserved: true },
  { slug: 'category/news', title: '动态', sort: 2, layout: 'items', cardType: 'standard', source: 'posts',
    itemFields: { cover: true, title: true, categoryPill: true, excerpt: true, date: true } },
  { slug: 'category/works', title: '作品', sort: 3, layout: 'children', cardType: 'standard', columns: 3,
    source: 'posts', reserved: true },
  { slug: 'category/project', title: '开发项目', parentSlug: 'category/works', sort: 1,
    layout: 'items', cardType: 'mosaic', columns: 3, source: 'posts',
    itemFields: { cover: true, title: true, date: false } },
  { slug: 'category/artwork', title: '绘画作品', parentSlug: 'category/works', sort: 2,
    layout: 'items', cardType: 'mosaic', columns: 3, source: 'posts' },
  { slug: 'category/log', title: '中二日志', parentSlug: 'category/works', sort: 3,
    layout: 'items', cardType: 'standard', source: 'posts' },
  { slug: 'category/notes', title: '学习笔记', parentSlug: 'category/works', sort: 4,
    layout: 'items', cardType: 'standard', source: 'posts', tagFilter: true },
  { slug: 'tools', title: '工具', sort: 4, layout: 'static', cardType: 'standard', source: 'posts' },
  { slug: 'personal', title: '关于', sort: 5, layout: 'static', cardType: 'standard', source: 'posts',
    reserved: true, contentFromWpPage: '个人信息' },
]

// 老库：把 posts.tags 的 JSON 文本拆进 tags / post_tags，随后删掉该列。
// 新库由 seedPostPages 直接写规范化表，这里检测不到 tags 列会直接跳过。
function migratePostTags(db: DatabaseSync) {
  if (!columnExists(db, 'posts', 'tags')) return

  const { n } = db.prepare('SELECT COUNT(*) AS n FROM post_tags').get() as { n: number }
  db.exec('BEGIN')
  try {
    if (n === 0) {
      const rows = db.prepare('SELECT id, tags FROM posts').all() as { id: number; tags: string }[]
      const insTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)')
      const getTag = db.prepare('SELECT id FROM tags WHERE name = ?')
      const insPostTag = db.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)')
      for (const row of rows) {
        let parsed: unknown
        try {
          parsed = JSON.parse(row.tags)
        } catch {
          parsed = []
        }
        if (!Array.isArray(parsed)) continue
        for (const raw of parsed) {
          const name = String(raw).trim()
          if (!name) continue
          insTag.run(name)
          const tag = getTag.get(name) as { id: number } | undefined
          if (tag) insPostTag.run(row.id, tag.id)
        }
      }
    }
    db.exec('ALTER TABLE posts DROP COLUMN tags')
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

// 页面种子只在空表时执行，之后由后台维护
function seedNavPages(db: DatabaseSync) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM nav_pages').get() as { n: number }
  if (n > 0) return

  db.exec('BEGIN')
  try {
    // 「关于」这类页面的正文原本存在 WordPress 静态页面表里，一次性搬进 nav_pages
    const wpContent = (title: string) => {
      const row = db.prepare('SELECT content FROM pages WHERE title = ?').get(title) as
        | { content: string }
        | undefined
      return row?.content ?? ''
    }

    const ins = db.prepare(
      `INSERT INTO nav_pages
         (slug, title, parent_id, sort_order, layout, card_type, columns, item_fields,
          content_source, latest_limit, show_cover, cover_image, is_home, tag_filter, content, reserved)
       VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const p of NAV_PAGE_SEED) {
      const defaults = ITEM_FIELD_DEFAULTS[p.cardType ?? 'standard'] ?? {}
      ins.run(
        p.slug,
        p.title,
        p.sort,
        p.layout,
        p.cardType ?? 'standard',
        p.columns ?? 1,
        JSON.stringify(p.itemFields ?? defaults),
        p.source,
        p.latestLimit ?? 10,
        p.showCover ? 1 : 0,
        p.coverImage ?? null,
        p.isHome ? 1 : 0,
        p.tagFilter ? 1 : 0,
        p.contentFromWpPage ? wpContent(p.contentFromWpPage) : '',
        p.reserved ? 1 : 0,
      )
    }

    // 第二遍：子页面的 parent_id 指向父页面（此时 id 已生成）
    const setParent = db.prepare(
      'UPDATE nav_pages SET parent_id = (SELECT id FROM nav_pages WHERE slug = ?) WHERE slug = ?',
    )
    for (const p of NAV_PAGE_SEED) if (p.parentSlug) setParent.run(p.parentSlug, p.slug)

    // 学习笔记的标签由该页面持有，顺序即筛选面板顺序
    const notes = db.prepare('SELECT id FROM nav_pages WHERE slug = ?').get('category/notes') as
      | { id: number }
      | undefined
    if (notes) {
      const insTag = db.prepare('INSERT OR IGNORE INTO tags (name, page_id, sort_order) VALUES (?, ?, ?)')
      NOTES_TAG_SEED.forEach((name, i) => insTag.run(name, notes.id, i))
    }

    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

// ===== 一次性迁移：分类模型 → 展示页面模型 =====
// 改造后文章的归属由 post_pages 表达，标签由页面持有；categories / post_categories /
// page_tags 与 posts.tags 列、nav_pages.category_id 列都不再需要。
const PAGE_MODEL_KEY = 'migration:page_model_v1'

function migratePageModel(db: DatabaseSync) {
  if (db.prepare('SELECT value FROM site_meta WHERE key = ?').get(PAGE_MODEL_KEY)) return

  const legacy =
    tableExists(db, 'post_categories') ||
    tableExists(db, 'page_tags') ||
    columnExists(db, 'nav_pages', 'category_id')

  db.exec('BEGIN')
  try {
    if (legacy) convertLegacyModel(db)
    else seedPostPages(db)
    db.prepare('INSERT OR REPLACE INTO site_meta (key, value) VALUES (?, ?)').run(
      PAGE_MODEL_KEY,
      new Date().toISOString(),
    )
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

// 老库：按「分类 → 页面」的对应关系把 post_categories 翻译成 post_pages
function convertLegacyModel(db: DatabaseSync) {
  const pageByCategory = new Map<number, number>()
  for (const r of db
    .prepare("SELECT id, category_id FROM nav_pages WHERE content_source = 'posts' AND category_id IS NOT NULL")
    .all() as { id: number; category_id: number }[]) {
    pageByCategory.set(r.category_id, r.id)
  }

  const insPage = db.prepare('INSERT OR IGNORE INTO post_pages (post_id, page_id) VALUES (?, ?)')
  if (tableExists(db, 'post_categories')) {
    for (const r of db.prepare('SELECT post_id, category_id FROM post_categories').all() as {
      post_id: number
      category_id: number
    }[]) {
      const pageId = pageByCategory.get(r.category_id)
      if (pageId) insPage.run(r.post_id, pageId)
    }
  }

  // 旧的聚合分类存的是分类 id，换算成对应的页面
  if (columnExists(db, 'nav_pages', 'aggregate_categories')) {
    const upd = db.prepare('UPDATE nav_pages SET aggregate_pages = ? WHERE id = ?')
    for (const r of db
      .prepare("SELECT id, aggregate_categories FROM nav_pages WHERE content_source = 'aggregate'")
      .all() as { id: number; aggregate_categories: string }[]) {
      const mapped = parseJsonArray(r.aggregate_categories)
        .map((cid) => pageByCategory.get(cid))
        .filter((id): id is number => id != null)
      upd.run(JSON.stringify(mapped), r.id)
    }
  }

  // 没有任何页面归属的文章并入「动态」（原「社区」分类下的文章即属此类）
  const news = db.prepare("SELECT id FROM nav_pages WHERE slug = 'category/news'").get() as
    | { id: number }
    | undefined
  if (news) {
    for (const r of db
      .prepare('SELECT id FROM posts WHERE id NOT IN (SELECT post_id FROM post_pages)')
      .all() as { id: number }[]) {
      insPage.run(r.id, news.id)
    }
  }

  // 标签归属：优先沿用 page_tags 的登记，其余挂到使用它的文章的第一个展示页面
  const owner = new Map<number, { pageId: number; order: number }>()
  if (tableExists(db, 'page_tags')) {
    for (const r of db
      .prepare('SELECT page_id, tag_id, sort_order FROM page_tags ORDER BY page_id, sort_order, tag_id')
      .all() as { page_id: number; tag_id: number; sort_order: number }[]) {
      if (!owner.has(r.tag_id)) owner.set(r.tag_id, { pageId: r.page_id, order: r.sort_order })
    }
  }
  for (const r of db
    .prepare(
      `SELECT pt.tag_id AS tag_id, MIN(pp.page_id) AS page_id
       FROM post_tags pt JOIN post_pages pp ON pp.post_id = pt.post_id
       GROUP BY pt.tag_id`,
    )
    .all() as { tag_id: number; page_id: number }[]) {
    if (!owner.has(r.tag_id)) owner.set(r.tag_id, { pageId: r.page_id, order: 0 })
  }

  // 重建 tags：旧的 name 全局唯一改为 (name, page_id) 唯一，并补上 page_id / sort_order
  const tags = db.prepare('SELECT id, name FROM tags').all() as { id: number; name: string }[]
  db.exec(`CREATE TABLE tags_v2 (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    page_id    INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE(name, page_id)
  )`)
  const insTag = db.prepare('INSERT INTO tags_v2 (id, name, page_id, sort_order) VALUES (?, ?, ?, ?)')
  for (const t of tags) {
    const o = owner.get(t.id)
    insTag.run(t.id, t.name, o?.pageId ?? 0, o?.order ?? 0)
  }
  db.exec('DROP TABLE tags')
  db.exec('ALTER TABLE tags_v2 RENAME TO tags')
  db.exec('CREATE INDEX IF NOT EXISTS idx_tags_page ON tags(page_id)')

  db.exec('DROP TABLE IF EXISTS page_tags')
  db.exec('DROP TABLE IF EXISTS post_categories')
  db.exec('DROP TABLE IF EXISTS categories')
  dropColumn(db, 'nav_pages', 'category_id')
  dropColumn(db, 'nav_pages', 'aggregate_categories')
}

// 打包数据集里的分类名 → 展示页面 slug，仅用于首次建库时还原文章的页面归属。
// 「社区」没有独立页面，其文章并入「动态」；「事务」的文章同时也属于「动态」，无需映射。
const SEED_CATEGORY_PAGE: Record<string, string> = {
  动态: 'category/news',
  社区: 'category/news',
  项目: 'category/project',
  绘画作品: 'category/artwork',
  日志: 'category/log',
  学习笔记: 'category/notes',
}

// 新库：把数据集里的分类与标签翻译成 post_pages / tags / post_tags
function seedPostPages(db: DatabaseSync) {
  const data = siteContent as any
  const pageIdBySlug = new Map<string, number>(
    (db.prepare('SELECT id, slug FROM nav_pages').all() as { id: number; slug: string }[]).map((p) => [
      p.slug,
      p.id,
    ]),
  )
  const categoryNameById = new Map<number, string>(
    (data.categories ?? []).map((c: any) => [Number(c.id), String(c.name)]),
  )

  const insPage = db.prepare('INSERT OR IGNORE INTO post_pages (post_id, page_id) VALUES (?, ?)')
  const insTag = db.prepare('INSERT OR IGNORE INTO tags (name, page_id, sort_order) VALUES (?, ?, 0)')
  const getTag = db.prepare('SELECT id FROM tags WHERE name = ? AND page_id = ?')
  const insPostTag = db.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)')

  for (const p of data.posts ?? []) {
    const pageIds: number[] = []
    for (const cid of p.categories ?? []) {
      const slug = SEED_CATEGORY_PAGE[categoryNameById.get(Number(cid)) ?? '']
      const pageId = slug ? pageIdBySlug.get(slug) : undefined
      if (pageId && !pageIds.includes(pageId)) pageIds.push(pageId)
    }
    for (const pageId of pageIds) insPage.run(p.id, pageId)

    // 标签由页面持有：挂到该文章的第一个展示页面下
    const owner = pageIds[0]
    if (owner == null) continue
    for (const raw of p.tags ?? []) {
      const name = String(raw).trim()
      if (!name) continue
      insTag.run(name, owner)
      const tag = getTag.get(name, owner) as { id: number } | undefined
      if (tag) insPostTag.run(p.id, tag.id)
    }
  }
}

// 种子只在空表时执行，已有库靠这段补齐后来修正过的字段。用 site_meta 打标记保证只跑一次，
// 之后用户在后台的改动不会被覆盖。
const NAV_PAGES_BACKFILL_KEY = 'migration:nav_pages_v1'

function backfillNavPages(db: DatabaseSync) {
  const done = db.prepare('SELECT value FROM site_meta WHERE key = ?').get(NAV_PAGES_BACKFILL_KEY)
  if (done) return

  db.exec('BEGIN')
  try {
    // 首页：最新事项 6 篇、单列，并补上封面图
    db.prepare(
      "UPDATE nav_pages SET latest_limit = 6, columns = 1, cover_image = COALESCE(cover_image, ?) WHERE slug = 'home'",
    ).run(HOME_COVER)

    // 开发项目卡片只有标题（原站无日期栏）；绘画作品保留「名字 + 日期」栏
    db.prepare(
      `UPDATE nav_pages SET item_fields = '{"cover":true,"title":true,"date":false}'
       WHERE slug = 'category/project'`,
    ).run()

    // 「关于」正文从 WordPress 静态页面「个人信息」迁移；已有内容则不覆盖
    const wp = db.prepare('SELECT content FROM pages WHERE title = ?').get('个人信息') as
      | { content: string }
      | undefined
    if (wp?.content) {
      db.prepare(
        "UPDATE nav_pages SET content = ? WHERE slug = 'personal' AND (content IS NULL OR content = '')",
      ).run(wp.content)
    }

    db.prepare('INSERT OR REPLACE INTO site_meta (key, value) VALUES (?, ?)').run(
      NAV_PAGES_BACKFILL_KEY,
      new Date().toISOString(),
    )
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

// 老库：card_type 列刚补上时所有页面都是默认值 'standard'。把首页与两个网格页
// 改成能复刻原站外观的条目类型，其余页面保持 standard（即原来的列表行卡）。
// 与上一段一样用 site_meta 打标记，只跑一次，之后用户在后台的选择不会被覆盖。
const CARD_TYPE_BACKFILL_KEY = 'migration:card_type_v1'

function backfillCardTypes(db: DatabaseSync) {
  const done = db.prepare('SELECT value FROM site_meta WHERE key = ?').get(CARD_TYPE_BACKFILL_KEY)
  if (done) return

  db.exec('BEGIN')
  try {
    db.prepare("UPDATE nav_pages SET card_type = 'overlay' WHERE slug = 'home'").run()
    db.prepare(
      "UPDATE nav_pages SET card_type = 'mosaic' WHERE slug IN ('category/project', 'category/artwork')",
    ).run()

    db.prepare('INSERT OR REPLACE INTO site_meta (key, value) VALUES (?, ?)').run(
      CARD_TYPE_BACKFILL_KEY,
      new Date().toISOString(),
    )
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

// 「静态文本」与「子页面」原本是 content_source 的取值，后来并入「展示类型」：
// 它们描述的是页面呈现成什么，而不是条目从哪来。老库把这两种模式搬到 layout，
// content_source 归还为 posts；原先的 text（文本）也并进 static——两者都是渲染正文。
// 放在所有老库迁移之后执行，保证读到的是迁移前的原始取值。
const LAYOUT_MODE_KEY = 'migration:layout_mode_v1'

function migrateLayoutModes(db: DatabaseSync) {
  const done = db.prepare('SELECT value FROM site_meta WHERE key = ?').get(LAYOUT_MODE_KEY)
  if (done) return

  db.exec('BEGIN')
  try {
    db.prepare("UPDATE nav_pages SET layout = 'static' WHERE layout = 'text'").run()
    db.prepare(
      "UPDATE nav_pages SET layout = 'static', content_source = 'posts' WHERE content_source = 'static'",
    ).run()
    db.prepare(
      "UPDATE nav_pages SET layout = 'children', content_source = 'posts' WHERE content_source = 'children'",
    ).run()

    db.prepare('INSERT OR REPLACE INTO site_meta (key, value) VALUES (?, ?)').run(
      LAYOUT_MODE_KEY,
      new Date().toISOString(),
    )
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

// 「列表」与「网格」原本是两个展示类型，现在合并为「条目项」——由每行列数决定单列还是多列；
// 「无」只占位，也并入「条目项」（没有文章时自然显示空态）。老库一次性改写。
const ITEM_LAYOUT_KEY = 'migration:item_layout_v1'

function migrateItemLayout(db: DatabaseSync) {
  const done = db.prepare('SELECT value FROM site_meta WHERE key = ?').get(ITEM_LAYOUT_KEY)
  if (done) return

  db.exec('BEGIN')
  try {
    db.prepare("UPDATE nav_pages SET layout = 'items' WHERE layout IN ('list', 'grid', 'none')").run()

    db.prepare('INSERT OR REPLACE INTO site_meta (key, value) VALUES (?, ?)').run(
      ITEM_LAYOUT_KEY,
      new Date().toISOString(),
    )
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

// 日期位置列是后加的，老库补列后全是默认值。按各条目类型原本的版式落位，
// 让升级后外观不变：全图叠加的日期原本在正文下方、网格卡在标题上方的信息行里。
// 与其它回填一样用 site_meta 打标记，只跑一次，之后用户在后台的选择不会被覆盖。
const DATE_POSITION_KEY = 'migration:date_position_v1'

function backfillDatePositions(db: DatabaseSync) {
  const done = db.prepare('SELECT value FROM site_meta WHERE key = ?').get(DATE_POSITION_KEY)
  if (done) return

  db.exec('BEGIN')
  try {
    db.prepare("UPDATE nav_pages SET date_position = 'below' WHERE card_type = 'overlay'").run()
    db.prepare("UPDATE nav_pages SET date_position = 'above' WHERE card_type = 'mosaic'").run()

    db.prepare('INSERT OR REPLACE INTO site_meta (key, value) VALUES (?, ?)').run(
      DATE_POSITION_KEY,
      new Date().toISOString(),
    )
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

// 累计口径从「COUNT(DISTINCT ip_hash) 现算」改为独立的 visit_visitor 集合后，
// 老库需要把历史明细里的唯一 IP 一次性灌进去，否则累计数会从 0 重新开始。
// 用 site_meta 打标记只跑一次；新库两边都空，跑完也等于没动。
const VISIT_VISITOR_KEY = 'migration:visit_visitor_v1'

function backfillVisitVisitors(db: DatabaseSync) {
  if (db.prepare('SELECT value FROM site_meta WHERE key = ?').get(VISIT_VISITOR_KEY)) return

  db.exec('BEGIN')
  try {
    db.exec('INSERT OR IGNORE INTO visit_visitor (ip_hash) SELECT DISTINCT ip_hash FROM visit_log')
    db.prepare('INSERT OR REPLACE INTO site_meta (key, value) VALUES (?, ?)').run(
      VISIT_VISITOR_KEY,
      new Date().toISOString(),
    )
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}