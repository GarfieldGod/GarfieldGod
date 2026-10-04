// /search 孤儿页的配置：封面、头像、个人信息与右侧快捷入口。
// 存在 site_meta 的 'search' 键下，未写入过时回落到与原 MainPage 一致的默认值。
import { useDb } from './db'

export interface SearchLink {
  label: string
  href: string
  icon: string
}

export interface SearchPageConfig {
  cover: string
  avatar: string
  name: string
  tagline: string
  /** 个人信息里的站点链接 */
  link: string
  links: SearchLink[]
  /** 头像查看器顶部标题（两侧的 ❮--- ---❯ 装饰由前端补） */
  viewerTitle: string
  /** 头像查看器的图片列表 */
  avatars: string[]
}

const SEARCH_META_KEY = 'search'

export const SEARCH_PAGE_DEFAULTS: SearchPageConfig = {
  cover: '/legacy/hello-world.jpg',
  avatar: '/legacy/psc.jpg',
  name: 'GarfieldGod',
  tagline: "I'm God.",
  link: 'https://garfieldgod.cn',
  viewerTitle: 'The Cutest Person In The World',
  avatars: [
    '/legacy/avatar-1.jpg',
    '/legacy/avatar-2.jpg',
    '/legacy/avatar-3.jpg',
    '/legacy/avatar-4.jpg',
    '/legacy/avatar-5.jpg',
  ],
  links: [
    { label: '哔哩哔哩', href: 'https://www.bilibili.com', icon: '/legacy/bilibili.png' },
    { label: '百度翻译', href: 'https://fanyi.baidu.com/', icon: '/legacy/links/baidu-translate.jpg' },
    { label: '百度', href: 'https://www.baidu.com/', icon: '/legacy/links/baidu.jpg' },
    { label: '开发者客栈', href: 'https://www.developers.pub', icon: '/legacy/links/developers-pub.png' },
    { label: '牛客网', href: 'https://www.nowcoder.com/', icon: '/legacy/links/nowcoder.png' },
    { label: '力扣', href: 'https://leetcode.cn/', icon: '/legacy/links/leetcode.png' },
    { label: '海投网', href: 'https://xyzp.haitou.cc/trade-113', icon: '/legacy/links/haitou.png' },
    { label: '社区', href: 'https://garfieldgod.cn/index.php/forum/', icon: '/legacy/links/community.png' },
  ],
}

// 地址会直接落进 <a href> / <img src>，只放行 http(s) 与站内相对路径，
// 挡掉 javascript: / data: 这类可执行协议。
function safeUrl(value: unknown, max = 600): string {
  const raw = typeof value === 'string' ? value.trim().slice(0, max) : ''
  if (!raw) return ''
  if (raw.startsWith('/')) return raw
  if (/^https?:\/\//i.test(raw)) return raw
  return ''
}

function safeText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function normalize(input: unknown): SearchPageConfig {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const links = Array.isArray(raw.links) ? raw.links : []
  const avatars = Array.isArray(raw.avatars) ? raw.avatars : []
  const cleanAvatars = avatars
    .slice(0, 60)
    .map((item) => safeUrl(item, 600))
    .filter((url) => url !== '')
  return {
    // 封面与头像是版面骨架，清空没有意义，缺失时回落默认图
    cover: safeUrl(raw.cover) || SEARCH_PAGE_DEFAULTS.cover,
    avatar: safeUrl(raw.avatar) || SEARCH_PAGE_DEFAULTS.avatar,
    name: safeText(raw.name, 60),
    tagline: safeText(raw.tagline, 120),
    link: safeUrl(raw.link),
    viewerTitle: safeText(raw.viewerTitle, 120) || SEARCH_PAGE_DEFAULTS.viewerTitle,
    // 查看器至少要有一张图，全删光时回落默认，避免打开后空白
    avatars: cleanAvatars.length ? cleanAvatars : [...SEARCH_PAGE_DEFAULTS.avatars],
    links: links
      .slice(0, 40)
      .map((item) => {
        const l = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
        return {
          label: safeText(l.label, 40),
          href: safeUrl(l.href),
          icon: safeUrl(l.icon),
        }
      })
      .filter((l) => l.href || l.icon),
  }
}

function parseStored(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}

export function getSearchPage(): SearchPageConfig {
  const row = useDb().prepare('SELECT value FROM site_meta WHERE key = ?').get(SEARCH_META_KEY) as
    | { value: string }
    | undefined
  if (!row) return normalize(SEARCH_PAGE_DEFAULTS)
  return normalize({ ...SEARCH_PAGE_DEFAULTS, ...(parseStored(row.value) as Record<string, unknown>) })
}

export function saveSearchPage(input: unknown): SearchPageConfig {
  const next = normalize(input)
  useDb()
    .prepare(
      "INSERT INTO site_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(SEARCH_META_KEY, JSON.stringify(next))
  return next
}