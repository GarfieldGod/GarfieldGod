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
  setHeader(event, 'Content-Length', info.size)
  setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable')
  return sendStream(event, createReadStream(target))
})
