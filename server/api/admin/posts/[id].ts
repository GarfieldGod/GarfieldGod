export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, message: '无效的文章 ID' })
  const method = getMethod(event)

  if (method === 'GET') {
    const post = getPostForAdmin(id)
    if (!post) throw createError({ statusCode: 404, message: '文章不存在' })
    return { post }
  }

  if (method === 'PUT') {
    const post = updatePost(id, parsePostInput(await readBody(event)))
    if (!post) throw createError({ statusCode: 404, message: '文章不存在' })
    return { post }
  }

  if (method === 'DELETE') {
    if (!getPostForAdmin(id)) throw createError({ statusCode: 404, message: '文章不存在' })

    // preview=1 只回报将删除的图片数量，供前台二次确认，不实际删除
    if (String(getQuery(event).preview ?? '') === '1') {
      return { preview: await postMediaStats(id) }
    }

    // 只动文章私有目录：媒体库的图片与其它文章引用的图片都不受影响
    const trashed = await trashPostMedia(id)
    deletePost(id)
    return { ok: true, trashed }
  }

  throw createError({ statusCode: 405, message: '不支持的请求方法' })
})