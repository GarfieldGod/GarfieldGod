import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'

// 后台新上传的媒体放在 .data/uploads，与构建产物解耦，通过 /uploads/** 对外提供
export default defineEventHandler(async (event) => {
  const rel = String(getRouterParam(event, 'path') ?? '')
  const root = resolve(uploadsDir())
  let target = resolve(join(root, rel))

  if (target !== root && !target.startsWith(root + sep)) {
    throw createError({ statusCode: 403, message: '非法路径' })
  }
  // 以点开头的目录（回收站 .trash）不对外提供
  if (rel.split('/').some((seg) => seg.startsWith('.'))) {
    throw createError({ statusCode: 403, message: '非法路径' })
  }

  let info = await stat(target).catch(() => null)

  // 派生缩略图缺失时回落原图：老图还没回填、gif 之类不派生缩略图的格式都会走到这里，
  // 否则卡片会挂一张 404 的坏图
  if (!info?.isFile()) {
    const origin = thumbOriginPath(target)
    const originInfo = origin ? await stat(origin).catch(() => null) : null
    if (origin && originInfo?.isFile()) {
      target = origin
      info = originInfo
    }
  }

  if (!info?.isFile()) {
    throw createError({ statusCode: 404, message: '文件不存在' })
  }

  setHeader(event, 'Content-Type', MIME_BY_EXT[extname(target).toLowerCase()] ?? 'application/octet-stream')
  setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable')
  // 音频/视频靠 Range 才能拖动进度，iOS Safari 更是要求 206 才肯播；
  // 这里显式实现，并如实声明支持，避免播放器在缓存未命中时拖不动进度条
  setHeader(event, 'Accept-Ranges', 'bytes')

  const range = getRequestHeader(event, 'range')
  if (range) {
    const parsed = parseRange(range, info.size)
    if (parsed.kind === 'ok') {
      setResponseStatus(event, 206)
      setHeader(event, 'Content-Range', `bytes ${parsed.start}-${parsed.end}/${info.size}`)
      setHeader(event, 'Content-Length', parsed.end - parsed.start + 1)
      return sendStream(event, createReadStream(target, { start: parsed.start, end: parsed.end }))
    }
    if (parsed.kind === 'unsatisfiable') {
      setResponseStatus(event, 416)
      setHeader(event, 'Content-Range', `bytes */${info.size}`)
      return ''
    }
    // 格式不认的 Range 按 RFC 忽略，继续走下面的整文件分支
  }

  setHeader(event, 'Content-Length', info.size)
  return sendStream(event, createReadStream(target))
})

type RangeResult =
  | { kind: 'ok'; start: number; end: number }
  | { kind: 'unsatisfiable' }
  /** 形式不认识（如多段 Range），按 RFC 忽略，退回整文件响应 */
  | { kind: 'ignore' }

/** 只处理单段 bytes 范围；多段与畸形写法一律忽略 */
function parseRange(header: string, size: number): RangeResult {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return { kind: 'ignore' }
  const [, rawStart, rawEnd] = m
  if (rawStart === '' && rawEnd === '') return { kind: 'ignore' }

  let start: number
  let end: number
  if (rawStart === '') {
    // 后缀写法 bytes=-N：取末尾 N 字节
    const suffix = Number(rawEnd)
    if (!Number.isFinite(suffix) || suffix <= 0) return { kind: 'ignore' }
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Number(rawEnd)
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return { kind: 'ignore' }
  if (start >= size) return { kind: 'unsatisfiable' }
  if (end < start) return { kind: 'ignore' }
  return { kind: 'ok', start, end: Math.min(end, size - 1) }
}
