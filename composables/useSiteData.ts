// 内容类型与后端 API 封装。
// 数据统一来自 Nitro 服务端（SQLite），前端不再直接读取 assets/data/site-content.json。

import type { NuxtApp } from '#app'

export interface PageRef {
  id: number
  title: string
  slug: string
  path: string
  /** 首页标记：前台始终不把首页作为「所属页面」展示 */
  isHome: boolean
}

/** 首页永远不作为「所属页面」展示 */
export function displayPages(pages: PageRef[]): PageRef[] {
  return pages.filter((p) => !p.isHome)
}

export interface TagRef {
  id: number
  name: string
  pageId: number
}

/**
 * 文章样式方案的附加设置。与服务端 server/utils/content.ts 的 PostStyleOptions 保持一致：
 * 各方案各取所需，未用到的字段保持默认值即可。
 */
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

/** 与服务端同样的兜底：空值或不合法字段一律回落到默认设置 */
export function resolvePostStyleOptions(value?: Partial<PostStyleOptions> | null): PostStyleOptions {
  const o = (value ?? {}) as Record<string, unknown>
  return {
    tocSide: o.tocSide === 'left' ? 'left' : 'right',
    tocProgress: o.tocProgress !== false,
    heroImage: typeof o.heroImage === 'string' ? o.heroImage : '',
    heroSize: o.heroSize === 'compact' || o.heroSize === 'tall' ? o.heroSize : 'standard',
    miniNav: o.miniNav !== false,
    sectionNumbers: o.sectionNumbers !== false,
    linkUrl: typeof o.linkUrl === 'string' ? o.linkUrl : '',
    linkDelay:
      typeof o.linkDelay === 'number' && Number.isFinite(o.linkDelay)
        ? Math.min(30, Math.max(0, Math.floor(o.linkDelay)))
        : POST_STYLE_OPTION_DEFAULTS.linkDelay,
  }
}

export interface Post {
  id: number
  slug: string
  title: string
  date: string
  modified: string
  link: string
  content: string
  excerpt: string
  featured: string | null
  /** 文章所在的展示页面（一篇文章可出现在多个页面） */
  pages: PageRef[]
  tags: TagRef[]
  status: string
  format: string
  /** 正文宽度挡位：'' 默认 / wide 宽幅 / normal 正常 / narrow 窄幅 */
  contentWidth?: string
  /** 文章样式方案：'' 默认（经典居中单栏）/ classic / toc / magazine / cards */
  postStyle?: string
  /** 文章样式方案的附加设置 */
  postStyleOptions?: PostStyleOptions
  /** 是否允许留言：false 时前台不显示留言面板 */
  allowComments?: boolean
  /** 仅文章详情接口返回：按 format 在服务端渲染好的正文 */
  html?: string
}

export interface SiteMeta {
  title: string
  tagline: string
  url: string
  /** 浏览器标签用的站名，与导航栏「名称」相互独立；未设置时回落到 title */
  tabTitle?: string
  /** 浏览器标签用的标语，与导航栏「签名」相互独立；未设置时回落到 tagline */
  tabTagline?: string
  /** 站点头像地址，未设置时前台回落到默认图 */
  avatar?: string
  /** 浏览器标签图标地址，未设置时前台回落到默认图 */
  favicon?: string
  generated?: string
  counts?: Record<string, number>
}

/** 浏览器标签的站名：优先「站名」，未设置时回落到导航栏「名称」 */
export function tabName(meta: SiteMeta) {
  return meta.tabTitle?.trim() || meta.title
}

/** 浏览器标签的标语：优先「标语」，未设置时回落到导航栏「签名」 */
export function tabTagline(meta: SiteMeta) {
  return meta.tabTagline?.trim() || meta.tagline
}

// ===== 页面（nav_pages）：页面形态与导航结构都由数据驱动 =====

/**
 * 展示类型：决定页面呈现成什么。items 是铺条目的容器（列数决定单列/多列），
 * static 渲染正文、children 竖排子页面总览，二者都不铺条目。
 */
export type PageLayout = 'items' | 'static' | 'children'
/** 条目类型：只决定条目的卡片外观，与容器形态（PageLayout）解耦 */
export type CardType = 'standard' | 'overlay' | 'horizontal' | 'editorial' | 'mosaic'
/** 内容来源：只回答「条目从哪来」 */
export type ContentSource = 'posts' | 'aggregate' | 'latest'
/** 日期位置：仅「全图叠加 / 网格卡」勾选了日期时生效，决定日期在卡片里的摆放 */
export type DatePosition = 'above' | 'below' | 'inline'
/** 卡片宽高比：'' 表示不设置，沿用条目类型自带的默认比例 */
export type AspectRatio = '' | '21:9' | '16:9' | '4:3' | '1:1' | '3:4'

// 只有这两种卡片支持自定义日期位置；其余类型日期位置固定（同排靠右 / 固定结构）
export function supportsDatePosition(cardType: CardType): boolean {
  return cardType === 'overlay' || cardType === 'mosaic'
}

/** 卡片实际使用的日期位置：不支持自定义的位置一律按同排靠右处理 */
export function resolveDatePosition(cardType: CardType, value?: DatePosition | null): DatePosition {
  if (!supportsDatePosition(cardType)) return 'inline'
  if (value === 'above' || value === 'below') return value
  return 'inline'
}

// 同理，宽高比也只对这两种卡片开放
export function supportsAspectRatio(cardType: CardType): boolean {
  return cardType === 'overlay' || cardType === 'mosaic'
}

/** 卡片实际生效的宽高比（CSS 值，如 '16 / 9'）；未设置或不受支持时返回空串 */
export function aspectRatioCss(cardType: CardType, value?: AspectRatio | string | null): string {
  if (!supportsAspectRatio(cardType)) return ''
  const raw = String(value ?? '').trim()
  return /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(raw) ? raw.replace(':', ' / ') : ''
}

export interface NavPage {
  id: number
  slug: string
  title: string
  parentId: number
  sortOrder: number
  navVisible: boolean
  layout: PageLayout
  cardType: CardType
  columns: number
  /** 条目项容器的每页展示数（翻页大小） */
  pageSize: number
  itemFields: Record<string, boolean>
  contentSource: ContentSource
  /** contentSource 为 aggregate 时，聚合哪些页面 */
  aggregatePages: number[]
  latestLimit: number
  showCover: boolean
  coverImage: string | null
  isHome: boolean
  tagFilter: boolean
  /** 子页面总览里是否显示「共 N 篇 / 查看全部」 */
  showChildDetail: boolean
  content: string
  /** 仅前台页面接口返回：静态正文按格式渲染好的 HTML（老内容为 HTML、新内容为 Markdown） */
  contentHtml?: string
  reserved: boolean
  /** 日期位置：仅「全图叠加 / 网格卡」且勾选了日期时生效 */
  datePosition: DatePosition
  /** 卡片宽高比：'' 表示沿用条目类型默认比例 */
  aspectRatio: AspectRatio
}

/** 静态正文的 HTML：优先服务端渲染结果，未渲染时回落到原始 content */
export function pageHtml(page: NavPage): string {
  return page.contentHtml ?? page.content
}

export interface NavPageTag {
  name: string
  count: number
}

/** 子页面总览里的一段：某个子页面 + 它的前 N 条内容 */
export interface ChildSection {
  page: NavPage
  posts: Post[]
  /** 子页面文章总数，用于「共 N 篇」与「查看全部」 */
  total: number
}

export interface NavPageDetail {
  page: NavPage
  posts: Post[]
  total: number
  /** 展示类型为 children 时：每个子页面的内容预览，按页面顺序竖排 */
  childSections: ChildSection[]
  tags: NavPageTag[]
  /** 页面 id → 页面标题，用于条目上的所属页面胶囊 */
  pageLabels: Record<string, string>
}

/** 页面 slug 本身就是路由路径（首页是唯一例外） */
export function navPagePath(page: NavPage): string {
  return page.isHome ? '/' : `/${page.slug}`
}

// ===== 导航提速：会话级数据缓存 =====
// Nuxt 默认只在水合期（payload）和静态产物（static.data）里复用数据，
// 客户端导航时一律重新请求——于是每次点导航都要等一次接口往返（经 Cloudflare 回源约 1 秒），
// 页面里的 await 把路由切换一起卡住。这里把「本次会话已取到的数据」也纳入缓存：
// 水合期带着服务端渲染的那一份，之后每次成功取数都会写回 payload.data，导航时直接命中。
// 首次访问某页仍会真取一次，其余页面交给空闲 / 悬停预热（见下方 prefetch*）。
export function sessionCachedData(key: string, app: NuxtApp, ctx: { cause: string }): any {
  if (app.isHydrating) return app.payload.data[key]
  // 手动或钩子触发的刷新（如发完留言后刷新列表）必须真正重新取
  if (ctx.cause.startsWith('refresh:')) return undefined
  return app.static.data[key] ?? app.payload.data[key]
}

/** 预热：把数据提前写进同一缓存槽，导航时 getCachedData 直接命中，页面同步出内容 */
function warm(nuxtApp: NuxtApp, key: string, url: string, query?: Record<string, unknown>) {
  if (!import.meta.client || nuxtApp.payload.data[key] != null) return
  $fetch(url, { query })
    .then((data) => {
      if (data != null) nuxtApp.payload.data[key] = data
    })
    .catch(() => {
      // 预热失败不影响正常导航：真点进去时还会再取一次
    })
}

function navPageUrl(slug: string) {
  return `/api/nav-pages/${slug.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`
}

/** 预热某个导航页（含首页 home） */
export function prefetchNavPage(slug: string, nuxtApp: NuxtApp) {
  warm(nuxtApp, `nav-page:${slug}`, navPageUrl(slug))
}

/**
 * 只预热正文详情：卡片进入视口时调用，请求量最小。
 * 正文是唯一决定「有没有东西可渲染」的数据；阅读数与留言晚到不影响阅读，
 * 留给悬停（prefetchPost）补齐，避免整屏卡片一进页面就发一堆请求。
 */
export function prefetchPostDetail(id: string | number, nuxtApp: NuxtApp) {
  warm(nuxtApp, `post:${id}`, `/api/posts/${id}`)
}

/** 预热文章详情页：正文、阅读数、留言一起备好，悬停 / 聚焦卡片时调用 */
export function prefetchPost(id: string | number, nuxtApp: NuxtApp) {
  prefetchPostDetail(id, nuxtApp)
  warm(nuxtApp, `views:${id}`, `/api/views/${id}`)
  warm(nuxtApp, `comments:${id}`, '/api/comments', { post: id })
}

export function useSiteMeta() {
  return useFetch<SiteMeta>('/api/meta', {
    key: 'site-meta',
    getCachedData: sessionCachedData,
    default: () => ({
      title: 'GarfieldGod',
      tagline: "I'm God.",
      url: '',
      tabTitle: '',
      tabTagline: '',
      avatar: '',
      favicon: '',
    }),
  })
}

export function usePostDetail(id: string | number) {
  return useFetch<{ post: Post }>(`/api/posts/${id}`, {
    key: `post:${id}`,
    getCachedData: sessionCachedData,
  })
}

export function useNavPages() {
  return useFetch<{ pages: NavPage[] }>('/api/nav-pages', {
    key: 'nav-pages',
    getCachedData: sessionCachedData,
    default: () => ({ pages: [] }),
  })
}

export function useNavPage(slug: string) {
  return useFetch<NavPageDetail>(navPageUrl(slug), {
    key: `nav-page:${slug}`,
    getCachedData: sessionCachedData,
  })
}