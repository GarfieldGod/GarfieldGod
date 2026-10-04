// /search 页配置的后台保存：路径在 /api/admin 下，由 admin-guard 统一鉴权。
export default defineEventHandler(async (event) => {
  if (getMethod(event) !== 'PUT') {
    throw createError({ statusCode: 405, message: '不支持的请求方法' })
  }

  const body = await readBody(event)
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, message: '缺少配置参数' })
  }

  return { config: saveSearchPage(body) }
})