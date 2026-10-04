export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, message: '无效的页面 ID' })
  const method = getMethod(event)

  if (method === 'GET') {
    const page = getNavPageForAdmin(id)
    if (!page) throw createError({ statusCode: 404, message: '页面不存在' })
    return { page }
  }

  if (method === 'PUT') {
    const page = updateNavPage(id, await readBody(event))
    if (!page) throw createError({ statusCode: 404, message: '页面不存在' })
    return { page }
  }

  if (method === 'DELETE') {
    if (!deleteNavPage(id)) throw createError({ statusCode: 404, message: '页面不存在' })
    return { ok: true }
  }

  throw createError({ statusCode: 405, message: '不支持的请求方法' })
})