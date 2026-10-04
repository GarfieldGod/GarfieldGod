import { useDb } from './db'
import { listPosts, type PostDTO } from './content'

/**
 * 展示类型：决定页面呈现成什么。
 * items 是「铺文章条目」的容器——列数决定单列（列表）还是多列（网格），
 * static 渲染正文、children 竖排子页面总览，二者都不铺条目。
 */
export type PageLayout = 'items' | 'static' | 'children'
/** 条目类型：只决定条目的卡片外观，与容器形态（PageLayout）解耦 */
export type CardType = 'standard' | 'overlay' | 'horizontal' | 'editorial' | 'mosaic'
/** 内容来源：只回答「条目从哪来」，不铺条目的展示类型用不到它 */
export type ContentSource = 'posts' | 'aggregate' | 'latest'
/** 日期位置：仅「全图叠加 / 网格卡」勾选了日期时生效，决定日期在卡片里的摆放 */
export type DatePosition = 'above' | 'below' | 'inline'
/** 卡片宽高比：'' 表示不设置，沿用条目类型自带的默认比例 */
export type AspectRatio = '' | '21:9' | '16:9' | '4:3' | '1:1' | '3:4'

export const PAGE_LAYOUTS: PageLayout[] = ['items', 'static', 'children']
export const CARD_TYPES: CardType[] = ['standard', 'overlay', 'horizontal', 'editorial', 'mosaic']
export const CONTENT_SOURCES: ContentSource[] = ['posts', 'aggregate', 'latest']
export const DATE_POSITIONS: DatePosition[] = ['above', 'below', 'inline']
export const ASPECT_RATIOS: AspectRatio[] = ['21:9', '16:9', '4:3', '1:1', '3:4']

export interface NavPageRow {
  id: number
  slug: string
  title: string
  parent_id: number
  sort_order: number
  nav_visible: number
  layout: string
  card_type: string
  columns: number
  page_size: number
  item_fields: string
  content_source: string
  aggregate_pages: string
  latest_limit: number
  show_cover: number
  cover_image: string | null
  is_home: number
  tag_filter: number
  /** 子页面总览里是否显示「共 N 篇 / 查看全部」 */
  show_child_detail: number
  content: string | null
  reserved: number
  date_position: string
  aspect_ratio: string
}

export interface NavPageDTO {
  id: number
  slug: string
  title: string
  parentId: number
  sortOrder: number
  navVisible: boolean
  layout: PageLayout
  cardType: CardType
  columns: number
  pageSize: number
  itemFields: Record<string, boolean>
  contentSource: ContentSource
  aggregatePages: number[]
  latestLimit: number
  showCover: boolean
  coverImage: string | null
  isHome: boolean
  tagFilter: boolean
  /** 子页面总览里是否显示「共 N 篇 / 查看全部」 */
  showChildDetail: boolean
  content: string
  reserved: boolean
  datePosition: DatePosition
  aspectRatio: AspectRatio
}

export interface PageTagDTO {
  id: number
  name: string
}

const PAGE_COLUMNS = `id, slug, title, parent_id, sort_order, nav_visible, layout,
  card_type, columns, page_size, item_fields, content_source, aggregate_pages, latest_limit,
  show_cover, cover_image, is_home, tag_filter, show_child_detail, content, reserved,
  date_position, aspect_ratio`

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw)
    return (parsed ?? fallback) as T
  } catch {
    return fallback
  }
}

export function toNavPageDTO(row: NavPageRow): NavPageDTO {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    parentId: row.parent_id,
    sortOrder: row.sort_order,
    navVisible: !!row.nav_visible,
    layout: row.layout as PageLayout,
    cardType: (row.card_type as CardType) || 'standard',
    columns: row.columns,
    pageSize: row.page_size || 10,
    itemFields: parseJson<Record<string, boolean>>(row.item_fields, {}),
    contentSource: row.content_source as ContentSource,
    aggregatePages: parseJson<number[]>(row.aggregate_pages, []),
    latestLimit: row.latest_limit,
    showCover: !!row.show_cover,
    coverImage: row.cover_image,
    isHome: !!row.is_home,
    tagFilter: !!row.tag_filter,
    // 老库补列前读到的可能是 undefined，这种一律按「显示」处理，与默认值一致
    showChildDetail: row.show_child_detail !== 0,
    content: row.content ?? '',
    reserved: !!row.reserved,
    datePosition: (row.date_position as DatePosition) || 'inline',
    aspectRatio: (row.aspect_ratio as AspectRatio) || '',
  }
}

export function listNavPages(): NavPageDTO[] {
  const rows = useDb()
    .prepare(`SELECT ${PAGE_COLUMNS} FROM nav_pages ORDER BY parent_id, sort_order, id`)
    .all() as NavPageRow[]
  return rows.map(toNavPageDTO)
}

export function navPageBySlug(slug: string): NavPageDTO | null {
  const row = useDb()
    .prepare(`SELECT ${PAGE_COLUMNS} FROM nav_pages WHERE slug = ?`)
    .get(slug) as NavPageRow | undefined
  return row ? toNavPageDTO(row) : null
}

export function navChildren(parentId: number): NavPageDTO[] {
  const rows = useDb()
    .prepare(`SELECT ${PAGE_COLUMNS} FROM nav_pages WHERE parent_id = ? ORDER BY sort_order, id`)
    .all(parentId) as NavPageRow[]
  return rows.map(toNavPageDTO)
}

/** 页面持有的标签，顺序即筛选面板顺序 */
export function listPageTags(pageId: number): PageTagDTO[] {
  return useDb()
    .prepare('SELECT id, name FROM tags WHERE page_id = ? ORDER BY sort_order, id')
    .all(pageId) as PageTagDTO[]
}

/** 全部标签，带归属页面：文章编辑器按展示页面分组渲染标签勾选框 */
export function listAllTags(): { id: number; name: string; pageId: number }[] {
  return useDb()
    .prepare('SELECT id, name, page_id AS pageId FROM tags ORDER BY page_id, sort_order, id')
    .all() as { id: number; name: string; pageId: number }[]
}

// 标签在本页文章里的命中数，用于面板上的计数
export function pageTagCounts(pageId: number): { name: string; count: number }[] {
  return useDb()
    .prepare(
      `SELECT t.name AS name,
              (SELECT COUNT(*) FROM post_tags x
                 JOIN posts p ON p.id = x.post_id AND p.status = 'published'
                 JOIN post_pages pp ON pp.post_id = x.post_id AND pp.page_id = t.page_id
               WHERE x.tag_id = t.id) AS count
       FROM tags t
       WHERE t.page_id = ?
       ORDER BY t.sort_order, t.id`,
    )
    .all(pageId) as { name: string; count: number }[]
}

export function resolvePagePosts(page: NavPageDTO): PostDTO[] {
  // 静态文本 / 子页面 都不铺文章条目：正文与子页面总览由各自的渲染分支处理，
  // 这里直接返回空，免得后台把无关的文章数显示成「收录 N 篇」。
  if (page.layout === 'static' || page.layout === 'children') return []

  switch (page.contentSource) {
    case 'posts':
      return listPosts({ pageId: page.id })
    case 'aggregate':
      return page.aggregatePages.length ? listPosts({ pageIds: page.aggregatePages }) : []
    case 'latest':
      // latestLimit 为 0 表示不限条数，取全部最新文章
      return listPosts(page.latestLimit > 0 ? { limit: page.latestLimit } : {})
    default:
      return []
  }
}