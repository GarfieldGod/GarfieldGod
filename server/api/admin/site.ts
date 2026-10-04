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
    return { meta: updateSiteMeta(body.meta) }
  }

  throw createError({ statusCode: 405, message: '不支持的请求方法' })
})
