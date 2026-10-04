import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'

// 后台新上传的媒体放在 .data/uploads，与构建产物解耦，通过 /uploads/** 对外提供
export default defineEventHandler(async (event) => {
  const rel = String(getRouterParam(event, 'path') ?? '')
  const root = resolve(uploadsDir())
  const target = resolve(join(root, rel))

  if (target !== root && !target.startsWith(root + sep)) {
    throw createError({ statusCode: 403, message: '非法路径' })
  }
  // 以点开头的目录（回收站 .trash）不对外提供
  if (rel.split('/').some((seg) => seg.startsWith('.'))) {
    throw createError({ statusCode: 403, message: '非法路径' })
  }

  const info = await stat(target).catch(() => null)
  if (!info || !info.isFile()) {
    throw createError({ statusCode: 404, message: '文件不存在' })
  }

  setHeader(event, 'Content-Type', MIME_BY_EXT[extname(target).toLowerCase()] ?? 'application/octet-stream')
  setHeader(event, 'Content-Length', info.size)
  setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable')
  return sendStream(event, createReadStream(target))
})
