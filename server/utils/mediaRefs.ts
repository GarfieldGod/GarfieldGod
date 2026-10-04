// 媒体引用统计：扫一遍所有可能存图片地址的文本字段，建「文件名 → 引用它的文章」索引。
// 按文件名而不是完整路径匹配：封面允许只存裸文件名（不带 /uploads 前缀），按路径会漏掉这类引用。
// 一次遍历建 map，耗时只跟文章总量相关，跟文件数量无关。
import { useDb } from './db'

// 任何以媒体扩展名结尾的非空白串都算一次引用，同时覆盖完整路径与裸文件名
const MEDIA_TOKEN = /[^\s"')\]<>]+\.(?:png|jpe?g|gif|webp|avif|mp4|webm|mp3)\b/gi

function basenameOf(token: string): string {
  const clean = token.split('?')[0].split('#')[0]
  const segment = clean.split('/').pop() ?? ''
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

export interface MediaRefs {
  /** 文件名 → 引用它的文章 id 集合 */
  posts: Map<string, Set<number>>
  /** 被页面正文 / 页面封面 / 站点信息引用过的文件名 */
  pages: Set<string>
}

export function collectMediaRefs(): MediaRefs {
  const db = useDb()
  const posts = new Map<string, Set<number>>()
  const pages = new Set<string>()

  // owner 为 null 表示来自页面或站点信息，只记「有没有被用」，不区分是哪一篇
  const scan = (value: unknown, owner: number | null) => {
    if (typeof value !== 'string' || !value) return
    for (const token of value.match(MEDIA_TOKEN) ?? []) {
      const name = basenameOf(token)
      if (!name) continue
      if (owner === null) {
        pages.add(name)
        continue
      }
      const set = posts.get(name) ?? new Set<number>()
      set.add(owner)
      posts.set(name, set)
    }
  }

  const postRows = db
    .prepare('SELECT id, content, excerpt, featured, post_style_options FROM posts')
    .all() as { id: number; content: string | null; excerpt: string | null; featured: string | null; post_style_options: string | null }[]
  for (const row of postRows) {
    scan(row.content, row.id)
    scan(row.excerpt, row.id)
    scan(row.featured, row.id)
    scan(row.post_style_options, row.id)
  }

  const pageRows = db
    .prepare('SELECT content, cover_image FROM nav_pages')
    .all() as { content: string | null; cover_image: string | null }[]
  for (const row of pageRows) {
    scan(row.content, null)
    scan(row.cover_image, null)
  }

  const meta = db.prepare("SELECT value FROM site_meta WHERE key = 'site'").get() as { value: string } | undefined
  scan(meta?.value, null)

  // /search 孤儿页的封面、头像与入口图标也属于站点级引用
  const searchMeta = db.prepare("SELECT value FROM site_meta WHERE key = 'search'").get() as
    | { value: string }
    | undefined
  scan(searchMeta?.value, null)

  return { posts, pages }
}

// 某个文件被多少篇文章引用
export function countPostRefs(refs: MediaRefs, name: string): number {
  return refs.posts.get(name)?.size ?? 0
}

export function hasPageRef(refs: MediaRefs, name: string): boolean {
  return refs.pages.has(name)
}
