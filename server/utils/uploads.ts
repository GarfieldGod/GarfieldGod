import { copyFile, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
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

// ---------- 派生缩略图 ----------
//
// 卡片封面只用到 340×300 上下的尺寸，却常常要拉 1MB 的原图。上传时顺带在原图旁边
// 生成两档 WebP（`基名.w720.webp` / `基名.w1600.webp`）：卡片引用缩略图，正文仍引用原图。
// 缩略图是派生文件——不进媒体库列表、随原图改名/删除，也由 /uploads 路由兜底回落原图。

export const THUMB_WIDTHS = [720, 1600] as const
export type ThumbWidth = (typeof THUMB_WIDTHS)[number]

// 可派生的源格式。gif 多为动图，派生后动画会丢；视频/音频本来就不是图片
const THUMBABLE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif'])

// 派生文件识别：原图全名 + .w<数字>.webp
const THUMB_NAME_RE = /\.w\d+\.webp$/i

export function isThumbName(name: string): boolean {
  return THUMB_NAME_RE.test(name)
}

// 命名接在原图全名之后（`photo.jpg` → `photo.jpg.w720.webp`）而不是替换扩展名，
// 这样从派生文件名就能还原出原图全名，缺缩略图时才能回落原图
export function thumbName(originalName: string, width: number): string {
  return `${originalName}.w${width}.webp`
}

// 从派生缩略图路径还原原图路径；不是派生文件返回 null
export function thumbOriginPath(path: string): string | null {
  return THUMB_NAME_RE.test(path) ? path.replace(THUMB_NAME_RE, '') : null
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Windows 上刚被 /uploads 路由读过（Nitro 的读流句柄还没释放）的文件，改名/删除会短暂
// 报 EBUSY/EPERM。这类锁是瞬时的——退避重试几次即可；不重试就会留下「原图改了名、
// 缩略图还叫旧名」的孤儿派生文件，媒体库里看不到、也永远不会被清理。
// 退避到约 1 秒：客户端还在下载大图时句柄会多占一会儿，太短等于没重试。
const TRANSIENT_FS_CODES = new Set(['EBUSY', 'EPERM', 'EACCES'])

async function withFsRetry<T>(op: () => Promise<T>, attempts = 7): Promise<T> {
  for (let i = 0; ; i += 1) {
    try {
      return await op()
    } catch (e: any) {
      if (i >= attempts - 1 || !TRANSIENT_FS_CODES.has(e?.code)) throw e
      await new Promise((r) => setTimeout(r, Math.min(25 * 2 ** i, 250)))
    }
  }
}

// 某张原图对应的全部派生文件名（改名/删除时按这个模式连带处理）
function thumbNameRe(originalName: string): RegExp {
  return new RegExp(`^${escapeRe(originalName)}\\.w\\d+\\.webp$`, 'i')
}

// 生成缩略图，返回成功写出的张数。
// 原图比目标宽度还小就不放大；失败只记 0，因为缩略图只是加速手段，
// 缺了由 /uploads 路由回落原图，不能让上传本身失败。
export async function generateThumbs(abs: string): Promise<number> {
  if (!THUMBABLE_EXT.has(splitExt(abs).ext.toLowerCase())) return 0

  const dir = dirname(abs)
  const name = basename(abs)
  let written = 0
  try {
    const sharp = (await import('sharp')).default
    for (const width of THUMB_WIDTHS) {
      await sharp(abs)
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(join(dir, thumbName(name, width)))
      written += 1
    }
  } catch {
    return written
  }
  return written
}

// 删掉某张原图派生出来的全部缩略图
export async function removeThumbs(abs: string): Promise<number> {
  const dir = dirname(abs)
  const re = thumbNameRe(basename(abs))
  let removed = 0
  for (const name of await readdir(dir).catch(() => [])) {
    if (!re.test(name)) continue
    await withFsRetry(() => rm(join(dir, name), { force: true }))
    removed += 1
  }
  return removed
}

// 原图改名后，把派生缩略图一起改名，保持「缩略图紧挨原图」的关系
async function renameThumbs(fromAbs: string, toAbs: string): Promise<void> {
  const dir = dirname(fromAbs)
  const fromName = basename(fromAbs)
  const toName = basename(toAbs)
  if (fromName === toName) return

  const re = thumbNameRe(fromName)
  for (const name of await readdir(dir).catch(() => [])) {
    const match = re.exec(name)
    if (!match) continue
    const suffix = name.slice(fromName.length)
    await withFsRetry(() => rename(join(dir, name), join(dir, `${toName}${suffix}`))).catch((e) => {
      console.warn('[thumbs] rename failed', name, '->', `${toName}${suffix}`, e.code, e.message)
    })
  }
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
      // 派生缩略图对用户不可见：媒体库列表、删除预览的体积/数量都只算原图
      if (isThumbName(entry.name)) continue
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

export interface PostMediaItem extends MediaItem {
  /** 归属文章 ID，前端据此显示「属于哪篇」 */
  postId: number
}

// 列出全部文章私有资源（posts/<id>/...）。媒体库的「文章私有资源」视图只读展示这些文件，
// 便于确认「某张图/某段音频挂在谁名下」。posts/_tmp 是未落库文章的暂存目录，不算文章资源。
export async function listAllPostMedia(): Promise<PostMediaItem[]> {
  const root = join(uploadsDir(), 'posts')
  const out: PostMediaItem[] = []

  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue
    const postId = Number(entry.name)
    if (!Number.isInteger(postId) || postId <= 0) continue
    const dir = join(root, entry.name)
    for (const file of await listMedia(dir, `/uploads/posts/${postId}`)) {
      out.push({ ...file, postId })
    }
  }

  return out.sort((a, b) => b.mtime.localeCompare(a.mtime))
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
  await withFsRetry(() => rm(abs, { force: true }))
  // 原图没了，派生缩略图就没有意义，一并清掉
  await removeThumbs(abs)
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

  await withFsRetry(() => rename(abs, target))
  await renameThumbs(abs, target)
  return target
}

// 把文章私有资源另存一份进媒体库。用复制而不是移动：原文件仍被文章正文/封面引用，
// 挪走就会变成坏图。副本按媒体库的「年/月」分层落盘，和直接上传的资源同一种组织方式。
export async function copyToLibrary(abs: string): Promise<MediaItem | null> {
  const info = await stat(abs).catch(() => null)
  if (!info?.isFile()) return null

  const now = new Date()
  const rel = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`
  const dir = join(libraryDir(), rel)
  await mkdir(dir, { recursive: true })

  // 媒体库里已有同名文件时补序号，不覆盖
  const target = await uniqueFilePath(dir, basename(abs))
  await withFsRetry(() => copyFile(abs, target))
  // 图片顺带生成卡片用的缩略图，跟直接上传保持一致
  await generateThumbs(target)

  const copied = await stat(target)
  const name = basename(target)
  return {
    url: `/uploads/library/${rel}/${name}`,
    name,
    path: `${rel}/${name}`,
    size: copied.size,
    mtime: copied.mtime.toISOString(),
  }
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