// 后台「自动获取图标」：抓取目标站点的 favicon 并转存到本站媒体库。
// 路径在 /api/admin 下，由 admin-guard 统一鉴权。
export default defineEventHandler(async (event) => {
  if (getMethod(event) !== 'POST') {
    throw createError({ statusCode: 405, message: '不支持的请求方法' })
  }

  const body = await readBody(event)
  const url = typeof body?.url === 'string' ? body.url.trim() : ''
  if (!url) throw createError({ statusCode: 400, message: '请先填写网站链接' })

  try {
    return await fetchSiteIcon(url)
  } catch (e: any) {
    throw createError({ statusCode: 422, message: e?.message || '获取图标失败' })
  }
})
