// 媒体引用统计：扫一遍所有可能存图片地址的文本字段，建「这个文件被谁引用」的索引。
//
// 关键点：引用要按「地址形态」分开算，不能用文件名一刀切。
// 早期版本只取 basename 匹配，于是「文章私有资源复制进媒体库」会立刻显示 1 篇引用：
// 副本文件名和原件一样，而原文引用的 /uploads/posts/<id>/x.png 也是同一个 basename，
// 就被算到了副本头上。可实际上文章引用的是 posts/ 下的原件，删掉媒体库那份并不会坏图。
//
// 现在的规则：
//   - 地址里带路径（含 /）→ 按规范化后的相对路径匹配，例如 library/2026/10/x.png；
//   - 地址只有裸文件名    → 才回落到按文件名匹配（兼容只写裸名的封面）。
// 这样 /uploads/posts/50/x.png 只会命中 posts 目录，不会再误算到 library 里的同名文件。
import { useDb } from './db'

// 任何以媒体扩展名结尾的非空白串都算一次引用候选。
// 括号一并排除：Markdown 的 ![alt](url) 里，'(' 紧挨着地址，不排除会把它带进 token。
const MEDIA_TOKEN = /[^\s"'()\]<>]+\.(?:png|jpe?g|gif|webp|avif|mp4|webm|mp3)\b/gi

/** 媒体库文件在路径索引里的前缀，与上传返回的 URL /uploads/library/<rel> 对应 */
const LIBRARY_PREFIX = 'library/'

function basenameOf(token: string): string {
  const segment = token.split('/').pop() ?? ''
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/**
 * 把带路径的地址规范化成「相对于 uploads 根目录」的路径，用来精确比对。
 * 裸文件名（不含 /）返回 null，交给文件名索引处理。
 */
function pathKeyOf(token: string): string | null {
  if (!token.includes('/')) return null
  const stripped = token
    // 去掉开头的 ./ 与多余的 /，让 /uploads/x 与 uploads/x 等价
    .replace(/^[./]+/, '')
    // /uploads/library/... 与 library/... 指向同一个文件
    .replace(/^uploads\//i, '')
  return stripped || null
}

export interface MediaRefs {
  /** 裸文件名引用：文件名 → 引用它的文章 id */
  byName: Map<string, Set<number>>
  /** 带路径引用：规范化相对路径 → 引用它的文章 id */
  byPath: Map<string, Set<number>>
  /** 被页面正文 / 页面封面 / 站点信息以裸文件名引用过的文件名 */
  pagesByName: Set<string>
  /** 同上，但引用带了路径 */
  pagesByPath: Set<string>
}

export function collectMediaRefs(): MediaRefs {
  const db = useDb()
  const byName = new Map<string, Set<number>>()
  const byPath = new Map<string, Set<number>>()
  const pagesByName = new Set<string>()
  const pagesByPath = new Set<string>()

  // owner 为 null 表示来自页面或站点信息，只记「有没有被用」，不区分是哪一篇
  const scan = (value: unknown, owner: number | null) => {
    if (typeof value !== 'string' || !value) return
    for (const raw of value.match(MEDIA_TOKEN) ?? []) {
      const token = raw.split('?')[0].split('#')[0]
      const name = basenameOf(token)
      if (!name) continue
      const path = pathKeyOf(token)

      if (owner === null) {
        // 与文章一侧同规则：带路径的只按路径算，裸文件名才按名字算，
        // 否则站点歌单里写 posts/50/x.mp3 也会把 library 下的同名副本算成「被引用」
        if (path) pagesByPath.add(path)
        else pagesByName.add(name)
        continue
      }

      // 裸文件名与带路径的引用分别入账，最后取并集，避免互相污染
      if (path) {
        const set = byPath.get(path) ?? new Set<number>()
        set.add(owner)
        byPath.set(path, set)
      } else {
        const set = byName.get(name) ?? new Set<number>()
        set.add(owner)
        byName.set(name, set)
      }
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

  return { byName, byPath, pagesByName, pagesByPath }
}

/**
 * 某个媒体库文件被多少篇文章引用。
 * relPath 是文件在媒体库内的相对路径（如 2026/10/x.png），用来做精确路径匹配；
 * name 是文件名，只用来接住「只写裸名」的老引用。
 */
export function countPostRefs(refs: MediaRefs, name: string, relPath: string): number {
  const ids = new Set<number>()
  for (const id of refs.byPath.get(LIBRARY_PREFIX + relPath) ?? []) ids.add(id)
  for (const id of refs.byName.get(name) ?? []) ids.add(id)
  return ids.size
}

export function hasPageRef(refs: MediaRefs, name: string, relPath: string): boolean {
  return refs.pagesByPath.has(LIBRARY_PREFIX + relPath) || refs.pagesByName.has(name)
}
