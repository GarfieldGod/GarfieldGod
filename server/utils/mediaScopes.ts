// 存量媒体分流：改造前所有上传都堆在 .data/uploads 下（根目录的扁平文件、
// 以及后加的 <年>/<月>/ 分层），没有「文章私有 / 媒体库」之分。
// 这里按「谁在用」一次性归位：
//   只被一篇文章引用 → posts/<id>/，随该文章删除
//   被多篇引用 / 只被页面引用 / 没人引用 → library/，当作可复用的独立资源
// 用 site_meta 打标记，只跑一次；文件先搬、后改库，中途出错会把已搬的文件挪回去。
import { mkdir, readdir, rename, stat } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { useDb } from './db'
import { libraryDir, postMediaDir, uploadsDir } from './uploads'

const MARKER = 'migration:media_scopes_v1'

// 这几个文件在代码里被当作「默认头像 / 默认图标 / 默认首页封面」的兜底值引用，
// 路径必须是稳定的常量，因此不按年/月分层，直接放在媒体库根目录。
export const PINNED_BUILTINS = new Set(['59-cropped-1-2.jpg', '605-1686742077-1.jpg'])

interface Moved {
  from: string
  to: string
}

// 媒体地址的边界：空白、引号、括号、尖括号都可能出现在 URL 之后
const URL_PATTERN = /\/uploads\/[^\s"')\]>]+/g

function extractUrls(values: (string | null | undefined)[]): string[] {
  const out: string[] = []
  for (const v of values) if (v) out.push(...(v.match(URL_PATTERN) ?? []))
  return out
}

// 逐个替换，长地址优先，避免短地址把长地址的前缀吃掉
function replaceAll(value: string, pairs: [string, string][]): string {
  let out = value
  for (const [from, to] of pairs) out = out.split(from).join(to)
  return out
}

// 列出待分流的文件：跳过已经分好类的 library / posts 与回收站
async function listLegacyFiles(): Promise<string[]> {
  const root = resolve(uploadsDir())
  const skip = new Set(['library', 'posts', '.trash'])
  const out: string[] = []

  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (dir === root && skip.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      out.push(relative(root, full).split('\\').join('/'))
    }
  }

  await walk(root)
  return out
}

// 目标目录里重名时补一个序号，绝不覆盖已有文件
async function uniqueTarget(dir: string, name: string): Promise<string> {
  let candidate = join(dir, name)
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : ''
  const stem = ext ? name.slice(0, -ext.length) : name
  for (let i = 1; ; i += 1) {
    const info = await stat(candidate).catch(() => null)
    if (!info) return candidate
    candidate = join(dir, `${stem}-${i}${ext}`)
  }
}

export interface MediaScopeMigrationResult {
  moved: number
  toPosts: number
  toLibrary: number
  rewritten: number
}

export async function migrateMediaScopes(): Promise<MediaScopeMigrationResult | null> {
  const db = useDb()
  if (db.prepare('SELECT value FROM site_meta WHERE key = ?').get(MARKER)) return null

  const posts = db
    .prepare('SELECT id, content, excerpt, featured, post_style_options FROM posts')
    .all() as { id: number; content: string | null; excerpt: string | null; featured: string | null; post_style_options: string | null }[]
  const pages = db
    .prepare('SELECT id, content, cover_image FROM nav_pages')
    .all() as { id: number; content: string | null; cover_image: string | null }[]

  // url → 引用它的文章 id 集合；页面引用记成 0，保证不会被当成某篇文章的私有资源
  const owners = new Map<string, Set<number>>()
  const note = (url: string, owner: number) => {
    const set = owners.get(url) ?? new Set<number>()
    set.add(owner)
    owners.set(url, set)
  }
  for (const p of posts) {
    for (const url of extractUrls([p.content, p.excerpt, p.featured, p.post_style_options])) note(url, p.id)
  }
  for (const pg of pages) {
    for (const url of extractUrls([pg.content, pg.cover_image])) note(url, 0)
  }

  const legacy = await listLegacyFiles()
  const pairs: [string, string][] = []
  const moved: Moved[] = []
  let toPosts = 0
  let toLibrary = 0

  try {
    for (const rel of legacy) {
      const url = `/uploads/${rel}`
      const ids = owners.get(url)
      const solo = ids && ids.size === 1 ? [...ids][0] : 0
      const from = join(uploadsDir(), rel)
      const info = await stat(from).catch(() => null)
      if (!info?.isFile()) continue

      const name = basename(rel)
      let to: string
      // 内置素材优先：代码兜底值依赖它的稳定路径，不能被归成某篇文章的私有资源
      if (PINNED_BUILTINS.has(name)) {
        to = await uniqueTarget(libraryDir(), name)
        toLibrary += 1
      } else if (solo > 0) {
        to = await uniqueTarget(postMediaDir(solo), name)
        toPosts += 1
      } else {
        // 归档到媒体库时按文件时间归入 <年>/<月>，与后台上传的排布保持一致
        const d = info.mtime
        const rel2 = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`
        to = await uniqueTarget(join(libraryDir(), rel2), name)
        toLibrary += 1
      }

      await mkdir(dirname(to), { recursive: true })
      await rename(from, to)
      moved.push({ from, to })

      const prefix =
        solo > 0
          ? `/uploads/posts/${solo}/${basename(to)}`
          : `/uploads/library/${relative(libraryDir(), to).split('\\').join('/')}`
      if (prefix !== url) pairs.push([url, prefix])
    }
  } catch (err) {
    // 文件搬到一半失败：把已经搬走的挪回原位，库还一个字都没改
    for (const m of moved.reverse()) await rename(m.to, m.from).catch(() => {})
    throw err
  }

  // 长地址优先，避免 /uploads/a.jpg 命中 /uploads/a.jpg.bak 之类的前缀
  pairs.sort((a, b) => b[0].length - a[0].length)

  let rewritten = 0
  db.exec('BEGIN')
  try {
    if (pairs.length) {
      const updPost = db.prepare(
        'UPDATE posts SET content = ?, excerpt = ?, featured = ?, post_style_options = ? WHERE id = ?',
      )
      for (const p of posts) {
        const content = replaceAll(p.content ?? '', pairs)
        const excerpt = replaceAll(p.excerpt ?? '', pairs)
        const featured = replaceAll(p.featured ?? '', pairs)
        const opts = replaceAll(p.post_style_options ?? '', pairs)
        if (
          content === (p.content ?? '') &&
          excerpt === (p.excerpt ?? '') &&
          featured === (p.featured ?? '') &&
          opts === (p.post_style_options ?? '')
        ) {
          continue
        }
        updPost.run(content, excerpt, featured, opts, p.id)
        rewritten += 1
      }

      const updPage = db.prepare('UPDATE nav_pages SET content = ?, cover_image = ? WHERE id = ?')
      for (const pg of pages) {
        const content = replaceAll(pg.content ?? '', pairs)
        const cover = replaceAll(pg.cover_image ?? '', pairs)
        if (content === (pg.content ?? '') && cover === (pg.cover_image ?? '')) continue
        updPage.run(content, cover, pg.id)
        rewritten += 1
      }

      // 站点信息里的头像 / 图标地址也可能是老路径
      const meta = db.prepare("SELECT value FROM site_meta WHERE key = 'site'").get() as
        | { value: string }
        | undefined
      if (meta) {
        const next = replaceAll(meta.value, pairs)
        if (next !== meta.value) {
          db.prepare("UPDATE site_meta SET value = ? WHERE key = 'site'").run(next)
          rewritten += 1
        }
      }
    }

    db.prepare('INSERT OR REPLACE INTO site_meta (key, value) VALUES (?, ?)').run(MARKER, new Date().toISOString())
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    for (const m of moved.reverse()) await rename(m.to, m.from).catch(() => {})
    throw err
  }

  return { moved: moved.length, toPosts, toLibrary, rewritten }
}