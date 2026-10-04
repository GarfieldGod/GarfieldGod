// 后台通用类型与请求辅助。数据全部来自 /api/admin/*。

import type { NavPage, PageRef, PostStyleOptions, TagRef } from './useSiteData'

export type AdminMode = 'password' | 'access' | 'dev' | 'locked'

export interface AdminSession {
  mode: AdminMode
  authenticated: boolean
}

export interface AdminPost {
  id: number
  slug: string
  title: string
  date: string
  modified: string
  link: string
  content: string
  excerpt: string
  featured: string | null
  /** 文章会在哪些展示页面出现 */
  pages: PageRef[]
  /** 标签由页面持有，标签项的 pageId 指向它的归属页面 */
  tags: TagRef[]
  status: string
  format: string
  /** 正文宽度挡位：'' 默认 / wide 宽幅 / normal 正常 / narrow 窄幅 */
  contentWidth: string
  /** 文章样式方案：'' 默认（经典居中单栏）/ classic / toc / magazine / cards */
  postStyle: string
  /** 文章样式方案的附加设置 */
  postStyleOptions: PostStyleOptions
  /** 是否允许留言 */
  allowComments: boolean
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

export interface MediaItem {
  url: string
  name: string
  path: string
  size: number
  mtime: string
}

/** 媒体库列表项：比文章私有图片多出引用统计 */
export interface LibraryFile extends MediaItem {
  /** 被多少篇文章引用 */
  refPosts: number
  /** 是否被页面正文 / 页面封面 / 站点信息引用 */
  refPages: boolean
}

export interface AdminStats {
  posts: number
  drafts: number
  comments: number
  hiddenComments: number
  views: number
  pages: number
}

// ===== 页面（nav_pages）管理 =====

export interface AdminNavPage extends NavPage {
  postCount: number
  childCount: number
  tagNames: string[]
}

export interface NavPagePayload {
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
  /** contentSource 为 aggregate 时聚合哪些页面 */
  aggregatePages: number[]
  latestLimit: number
  showCover: boolean
  coverImage: string | null
  tagFilter: boolean
  /** 「子页面」展示类型：总览里是否显示「共 N 篇 / 查看全部」 */
  showChildDetail: boolean
  content: string
  /** 本页面持有的标签，顺序即筛选面板顺序 */
  tagNames: string[]
}

// 展示类型：条目项由「每行列数」决定单列（列表）还是多列（网格）
export const LAYOUT_LABELS: Record<string, string> = {
  items: '条目项',
  static: '静态文本',
  children: '子页面',
}

// 条目类型只决定卡片外观，与「展示类型」（容器形态）相互独立。
// 全图叠加、网格卡支持自定义日期位置，排在相邻位置便于对照。
export const CARD_TYPE_LABELS: Record<string, string> = {
  standard: '标准',
  horizontal: '左图右文',
  editorial: '极简文字',
  overlay: '全图叠加',
  mosaic: '网格卡',
}

// 每行列数上限：由各条目类型的硬最小宽度反推（标准 228px / 左图右文 196px / 极简文字 334px）。
// 主区还会被标签筛选面板挤掉 232px（200px 面板 + 32px 间距），所以按「开面板 + 目标列数」倒推。
export const CARD_MAX_COLUMNS: Record<string, number> = {
  standard: 3,
  horizontal: 2,
  editorial: 1,
  overlay: 4,
  mosaic: 4,
}

export function cardMaxColumns(cardType: string): number {
  return CARD_MAX_COLUMNS[cardType] ?? 4
}

// 日期位置：仅「全图叠加 / 网格卡」勾选了日期时可选，决定日期在卡片里的摆放
export const DATE_POSITION_LABELS: Record<string, string> = {
  above: '标题上方',
  below: '标题下方',
  inline: '标题同排靠右',
}

// 卡片宽高比：空串表示不设置，沿用条目类型自带的默认比例
export const ASPECT_RATIO_LABELS: Record<string, string> = {
  '': '默认',
  '21:9': '21:9',
  '16:9': '16:9',
  '4:3': '4:3',
  '1:1': '1:1',
  '3:4': '3:4',
}

// 文章样式方案：'' 即默认（经典居中单栏），与其余方案并列可选
export const POST_STYLE_LABELS: Record<string, string> = {
  '': '默认',
  classic: '经典单栏',
  toc: '左文右栏',
  magazine: '杂志大图',
  cards: '分节卡片',
  link: '超链接',
}

export const CONTENT_SOURCE_LABELS: Record<string, string> = {
  posts: '本页文章',
  aggregate: '聚合页面',
  latest: '最新文章',
}

export const ITEM_FIELD_LABELS: Record<string, string> = {
  cover: '封面图',
  title: '标题',
  excerpt: '摘要',
  date: '日期',
  categoryPill: '页面胶囊',
}

// 与服务端 ITEM_FIELD_DEFAULTS 对齐：切换条目类型后一键恢复默认字段。
// 字段勾选框只决定卡片里显示哪些内容，不影响条目类型本身。
const DEFAULT_ITEM_FIELDS: Record<string, boolean> = {
  cover: true,
  title: true,
  excerpt: true,
  date: true,
  categoryPill: true,
}
export const ITEM_FIELD_DEFAULTS: Record<string, Record<string, boolean>> = {
  standard: { ...DEFAULT_ITEM_FIELDS },
  overlay: { ...DEFAULT_ITEM_FIELDS },
  horizontal: { ...DEFAULT_ITEM_FIELDS },
  editorial: { ...DEFAULT_ITEM_FIELDS },
  mosaic: { ...DEFAULT_ITEM_FIELDS },
}

export interface PostPayload {
  title: string
  date: string
  content: string
  excerpt?: string
  featured?: string | null
  /** 文章会在哪些展示页面出现 */
  pageIds: number[]
  /** 已勾选的标签 id，必须属于所选展示页面 */
  tagIds: number[]
  status: string
  format: string
  contentWidth?: string
  postStyle?: string
  postStyleOptions?: PostStyleOptions
  /** 是否允许留言；缺省视为允许 */
  allowComments?: boolean
}

export function useAdminSession() {
  return useFetch<AdminSession>('/api/admin/session', {
    key: 'admin-session',
    default: () => ({ mode: 'dev', authenticated: true }),
  })
}

export function adminError(e: unknown, fallback = '操作失败'): string {
  const err = e as { data?: { message?: string; statusMessage?: string }; message?: string }
  return err?.data?.message || err?.data?.statusMessage || err?.message || fallback
}

export function formatDateTime(value: string): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// <input type="datetime-local"> 需要本地时间字符串，不能用 ISO 的 UTC 表示
export function toLocalInput(value: string): string {
  const d = value ? new Date(value) : new Date()
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
