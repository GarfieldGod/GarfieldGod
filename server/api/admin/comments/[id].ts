export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, message: '无效的评论 ID' })
  const method = getMethod(event)

  if (method === 'PATCH') {
    const body = await readBody(event)
    const status = String(body?.status ?? '')
    if (!COMMENT_STATUSES.includes(status as any)) {
      throw createError({ statusCode: 400, message: '无效的评论状态' })
    }
    if (!setCommentStatus(id, status)) {
      throw createError({ statusCode: 404, message: '评论不存在' })
    }
    return { ok: true }
  }

  if (method === 'DELETE') {
    if (!deleteComment(id)) throw createError({ statusCode: 404, message: '评论不存在' })
    return { ok: true }
  }

  throw createError({ statusCode: 405, message: '不支持的请求方法' })
})
