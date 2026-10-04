import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

// 上传文件放在 .data 下（与数据库同处持久化目录），不进构建产物
export function uploadsDir(): string {
  return process.env.GG_UPLOAD_DIR || resolve(process.cwd(), '.data', 'uploads')
}

// 媒体库：主动上传的独立资源，可被文章引用；删文章不会碰它
export function libraryDir(): string {
  return join(uploadsDir(), 'library')
}

// 文章私有资源（封面、正文插图），随文章删除
export function postMediaDir(postId: number | string): string {
  return join(uploadsDir(), 'posts', String(postId))
}

// 新文章尚未落库时的暂存目录，保存时整体改名为 posts/<id>
export function postTmpRoot(): string {
  return join(uploadsDir(), 'posts', '_tmp')
}

// 删文章时先把私有目录挪进来，保留一段时间再清理
export function trashDir(): string {
  return join(uploadsDir(), '.trash')
}

export const TRASH_KEEP_DAYS = 30

// 暂存组名：客户端生成，用于把「还没 ID 的文章」的上传归到一处
export const MEDIA_GROUP_PATTERN = /^[a-z0-9-]{8,40}$/i

const ALLOWED = new Map<string, string>([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['image/avif', '.avif'],
  ['video/mp4', '.mp4'],
  ['video/webm', '.webm'],
  ['audio/mpeg', '.mp3'],
])

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

export function isAllowedMime(mime: string | undefined): boolean {
  return !!mime && ALLOWED.has(mime)
}

// 文件名只保留字母数字与 -_，其余（含中文与空格）统一转成连字符，避免 URL 编码与路径问题
export function safeBaseName(name: string): string {
  const withoutExt = name.replace(/\.[^./\\]*$/, '')
  const cleaned = withoutExt
    .normalize('NFKD')
    .replace(/[^\w-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
  return cleaned.slice(0, 60) || 'file'
}

export function extensionFor(mime: string, originalName: string): string {
  const fromMime = ALLOWED.get(mime)
  if (fromMime) return fromMime
  const match = /\.[a-z0-9]+$/i.exec(originalName)
  return match ? match[0].toLowerCase() : '.bin'
}

export const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
}

export interface MediaItem {
  url: string
  name: string
  path: string
  size: number
  mtime: string
}

export interface MediaStats {
  count: number
  bytes: number
}

export interface StoredFile {
  name: string
  size: number
  mtime: string
}

// 落盘：文件名带时间戳前缀，同一秒内多次上传也不会互相覆盖
export async function storeUpload(
  dir: string,
  filename: string,
  mime: string,
  data: Buffer,
): Promise<StoredFile> {
  await mkdir(dir, { recursive: true })
  const name = `${Date.now()}-${safeBaseName(filename)}${extensionFor(mime, filename)}`
  await writeFile(join(dir, name), data)
  return { name, size: data.length, mtime: new Date().toISOString() }
}

// 递归列出一个目录下的文件，url 前缀由调用方给出（媒体库 / 某篇文章）
export async function listMedia(dir: string, urlPrefix: string): Promise<MediaItem[]> {
  const out: MediaItem[] = []

  async function walk(current: string, prefix: string) {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(join(current, entry.name), rel)
        continue
      }
      const info = await stat(join(current, entry.name)).catch(() => null)
      if (!info) continue
      out.push({
        url: `${urlPrefix}/${rel}`,
        name: entry.name,
        path: rel,
        size: info.size,
        mtime: info.mtime.toISOString(),
      })
    }
  }

  await walk(dir, '')
  return out.sort((a, b) => b.mtime.localeCompare(a.mtime))
}

export async function postMediaStats(postId: number): Promise<MediaStats> {
  const files = await listMedia(postMediaDir(postId), '')
  return { count: files.length, bytes: files.reduce((sum, f) => sum + f.size, 0) }
}

// ---------- 媒体库单文件操作（改名 / 删除） ----------

// 拆分扩展名：以点开头的隐藏文件不算扩展名
export function splitExt(name: string): { base: string; ext: string } {
  const i = name.lastIndexOf('.')
  return i > 0 ? { base: name.slice(0, i), ext: name.slice(i) } : { base: name, ext: '' }
}

// 把媒体库内的相对路径解析成绝对路径，越界（../）或空路径返回 null
export function libraryFilePath(rel: unknown): string | null {
  const key = typeof rel === 'string' ? rel.trim() : ''
  if (!key || key.includes('\0')) return null
  const root = resolve(libraryDir())
  const target = resolve(root, key)
  if (!target.startsWith(root + sep)) return null
  return target
}

// 改名用的基名：去掉路径分隔与控制字符，但保留中文等 Unicode 字母（否则中文名会被清成空）
export function safeMediaBaseName(name: string): string {
  return name
    .replace(/[/\\]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
}

// 同一目录内重名时补序号，绝不覆盖已有文件
async function uniqueFilePath(dir: string, name: string): Promise<string> {
  const { base, ext } = splitExt(name)
  let candidate = join(dir, name)
  for (let i = 1; ; i += 1) {
    const info = await stat(candidate).catch(() => null)
    if (!info) return candidate
    candidate = join(dir, `${base}-${i}${ext}`)
  }
}

// 单个文件的 MediaItem；文件不存在或不是普通文件返回 null
export async function describeMedia(abs: string, url: string, rel: string): Promise<MediaItem | null> {
  const info = await stat(abs).catch(() => null)
  if (!info?.isFile()) return null
  return { url, name: basename(abs), path: rel, size: info.size, mtime: info.mtime.toISOString() }
}

export async function removeMediaFile(abs: string): Promise<boolean> {
  const info = await stat(abs).catch(() => null)
  if (!info?.isFile()) return false
  await rm(abs, { force: true })
  return true
}

// 改名：只换基名，扩展名沿用原文件的（用户输入里带了扩展名也忽略，避免改成不匹配的格式）
export async function renameMediaFile(abs: string, wanted: string): Promise<string | null> {
  const info = await stat(abs).catch(() => null)
  if (!info?.isFile()) return null

  const dir = dirname(abs)
  const { base: currentBase, ext } = splitExt(basename(abs))
  // 先清洗再拆扩展名：否则 "../../evil/name" 会先被拆成 base=".."、ext="/evil/name"
  const base = splitExt(safeMediaBaseName(wanted)).base || currentBase
  const target = await uniqueFilePath(dir, `${base}${ext}`)
  if (resolve(target) === resolve(abs)) return abs

  await rename(abs, target)
  return target
}

// 删文章时只处理文章私有目录：媒体库与其它文章的图片都不受影响
export async function trashPostMedia(postId: number): Promise<MediaStats> {
  const stats = await postMediaStats(postId)
  if (!stats.count) return stats
  await mkdir(trashDir(), { recursive: true })
  await rename(postMediaDir(postId), join(trashDir(), `${Date.now()}-${postId}`))
  return stats
}

// 回收站条目名形如 <时间戳>-<文章ID>，时间戳才是「删进来的时刻」。
// 不能用目录 mtime：rename 会保留原目录的 mtime，老文章一删就会被当成过期文件清掉。
const TRASH_ENTRY = /^(\d{10,})-\d+$/

// 新文章保存后，把暂存目录认领为 posts/<id>；返回是否真的发生了移动
export async function adoptPostMedia(group: unknown, postId: number): Promise<boolean> {
  const key = typeof group === 'string' ? group.trim() : ''
  if (!MEDIA_GROUP_PATTERN.test(key)) return false

  const from = join(postTmpRoot(), key)
  const info = await stat(from).catch(() => null)
  if (!info?.isDirectory()) return false

  const to = postMediaDir(postId)
  await rm(to, { recursive: true, force: true })
  await rename(from, to)
  return true
}

// 清理过期回收站与未被认领的暂存目录（用户放弃编辑时留下的）
export async function sweepUploads(keepDays = TRASH_KEEP_DAYS): Promise<number> {
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000
  let removed = 0

  const entries = await readdir(trashDir(), { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const match = TRASH_ENTRY.exec(entry.name)
    if (!match) continue
    if (Number(match[1]) >= cutoff) continue
    await rm(join(trashDir(), entry.name), { recursive: true, force: true })
    removed += 1
  }

  // 暂存组名是随机串、不含时间，只能按目录本身的时间判断
  for (const entry of await readdir(postTmpRoot(), { withFileTypes: true }).catch(() => [])) {
    const full = join(postTmpRoot(), entry.name)
    const info = await stat(full).catch(() => null)
    if (!info || info.mtimeMs >= cutoff) continue
    await rm(full, { recursive: true, force: true })
    removed += 1
  }

  return removed
}