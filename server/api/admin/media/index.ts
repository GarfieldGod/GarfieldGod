import { join, relative, resolve } from 'node:path'

interface UploadTarget {
  dir: string
  url: string
  /** 相对 uploads 根目录的子路径，用于 MediaItem.path；媒体库按年/月分层，文章目录是平的 */
  rel: string
}

function libraryTarget(): UploadTarget {
  const now = new Date()
  const rel = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`
  return { dir: join(libraryDir(), rel), url: `/uploads/library/${rel}`, rel }
}

// scope=post：已保存的文章用 postId，还没落库的新文章用客户端生成的 group
function postTarget(query: Record<string, unknown>): UploadTarget {
  const postId = Number(query.postId)
  if (Number.isInteger(postId) && postId > 0) {
    return { dir: postMediaDir(postId), url: `/uploads/posts/${postId}`, rel: '' }
  }

  const group = String(query.group ?? '').trim()
  if (!MEDIA_GROUP_PATTERN.test(group)) {
    throw createError({ statusCode: 400, message: '缺少文章 ID 或暂存组' })
  }
  return { dir: join(postTmpRoot(), group), url: `/uploads/posts/_tmp/${group}`, rel: '' }
}

export default defineEventHandler(async (event) => {
  const method = getMethod(event)
  const query = getQuery(event)

  if (method === 'GET') {
    await sweepUploads()

    // scope=post 时列某篇文章自己的图片；默认只列媒体库，
    // 文章私有图片不出现在媒体库里
    if (String(query.scope ?? '') === 'post') {
      const postId = Number(query.postId)
      if (!Number.isInteger(postId) || postId <= 0) {
        throw createError({ statusCode: 400, message: '无效的文章 ID' })
      }
      return { files: await listMedia(postMediaDir(postId), `/uploads/posts/${postId}`) }
    }

    const refs = collectMediaRefs()
    return {
      files: (await listMedia(libraryDir(), '/uploads/library')).map((f) => ({
        ...f,
        refPosts: countPostRefs(refs, f.name),
        refPages: hasPageRef(refs, f.name),
      })),
    }
  }

  if (method === 'POST') {
    const parts = await readMultipartFormData(event)
    const file = parts?.find((p) => p.filename && p.data?.length)
    if (!file) throw createError({ statusCode: 400, message: '没有收到文件' })
    if (!isAllowedMime(file.type)) {
      throw createError({ statusCode: 415, message: `不支持的文件类型：${file.type || '未知'}` })
    }
    if (file.data.length > MAX_UPLOAD_BYTES) {
      throw createError({ statusCode: 413, message: '文件超过 20MB 限制' })
    }

    // 文章编辑器上传的进文章私有目录，随文章删除；站点设置与媒体库上传的进媒体库
    const target = String(query.scope ?? '') === 'post' ? postTarget(query) : libraryTarget()
    const stored = await storeUpload(target.dir, file.filename!, file.type!, file.data)
    // 原图落盘后顺带生成卡片用的 WebP 缩略图（失败不拦上传，缺失时由 /uploads 回落原图）
    await generateThumbs(join(target.dir, stored.name))

    setResponseStatus(event, 201)
    return {
      file: {
        url: `${target.url}/${stored.name}`,
        name: stored.name,
        path: target.rel ? `${target.rel}/${stored.name}` : stored.name,
        size: stored.size,
        mtime: stored.mtime,
      },
    }
  }

  // 改名与删除只作用于媒体库：文章私有图片由文章自己管理，这里不给入口
  if (method === 'PATCH') {
    const body = await readBody(event)
    const target = libraryFilePath(body?.path)
    if (!target) throw createError({ statusCode: 400, message: '无效的文件路径' })

    const name = String(body?.name ?? '').trim()
    if (!name) throw createError({ statusCode: 400, message: '文件名不能为空' })

    const moved = await renameMediaFile(target, name)
    if (!moved) throw createError({ statusCode: 404, message: '文件不存在' })

    const rel = relative(resolve(libraryDir()), moved).split('\\').join('/')
    const file = await describeMedia(moved, `/uploads/library/${rel}`, rel)
    if (!file) throw createError({ statusCode: 404, message: '文件不存在' })
    return { file }
  }

  if (method === 'DELETE') {
    const target = libraryFilePath(query.path)
    if (!target) throw createError({ statusCode: 400, message: '无效的文件路径' })
    if (!(await removeMediaFile(target))) throw createError({ statusCode: 404, message: '文件不存在' })
    return { ok: true }
  }

  throw createError({ statusCode: 405, message: '不支持的请求方法' })
})