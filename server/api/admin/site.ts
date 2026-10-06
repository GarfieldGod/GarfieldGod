import { normalizeMediaSrc } from '../../../utils/media'

export default defineEventHandler(async (event) => {
  const method = getMethod(event)

  if (method === 'GET') {
    return { meta: getSiteMeta() }
  }

  if (method === 'PUT') {
    const body = await readBody(event)
    if (!body?.meta || typeof body.meta !== 'object') {
      throw createError({ statusCode: 400, message: '缺少 meta 参数' })
    }
    const meta: Record<string, unknown> = { ...body.meta }
    // 歌单由后台表单提交，这里统一收口：丢掉空条目、截断超长字段，
    // 免得脏数据进了 site_meta，前台播放器要跟着做防御
    if ('playlist' in meta) meta.playlist = normalizePlaylist(meta.playlist)
    if ('playerEnabled' in meta) meta.playerEnabled = meta.playerEnabled !== false
    return { meta: updateSiteMeta(meta) }
  }

  throw createError({ statusCode: 405, message: '不支持的请求方法' })
})

interface PlaylistEntry {
  title: string
  artist: string
  src: string
}

/** 最多 50 首；没有音频地址的条目直接丢弃，曲名缺失时给个占位 */
function normalizePlaylist(value: unknown): PlaylistEntry[] {
  if (!Array.isArray(value)) return []
  const out: PlaylistEntry[] = []
  for (const item of value.slice(0, 50)) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    // 顺手规范化站内地址：后台是手填输入框，很容易漏掉开头的斜杠，
    // 那样音频元素会按相对当前文章的路径去取，必然 404
    const src = normalizeMediaSrc(typeof raw.src === 'string' ? raw.src.slice(0, 500) : '')
    if (!src) continue
    out.push({
      title: (typeof raw.title === 'string' ? raw.title.trim().slice(0, 120) : '') || '未命名曲目',
      artist: typeof raw.artist === 'string' ? raw.artist.trim().slice(0, 120) : '',
      src,
    })
  }
  return out
}
