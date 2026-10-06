import { join, resolve, sep } from 'node:path'

// 把「文章私有资源」复制一份进媒体库。只接受 posts/ 下的源文件：
// 原文件留在原处继续供文章引用，媒体库里多一份可长期复用的副本。
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const rel = String(body?.path ?? '')
    .trim()
    .replace(/\\/g, '/')

  const root = resolve(uploadsDir())
  const postsRoot = resolve(join(root, 'posts'))
  const src = resolve(join(root, rel))

  if (!rel.startsWith('posts/') || rel.includes('\0') || !src.startsWith(postsRoot + sep)) {
    throw createError({ statusCode: 400, message: '无效的源文件路径' })
  }

  const file = await copyToLibrary(src)
  if (!file) throw createError({ statusCode: 404, message: '文件不存在' })

  setResponseStatus(event, 201)
  return { file }
})
