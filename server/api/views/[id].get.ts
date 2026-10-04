export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, message: '无效的文章 ID' })
  }
  return { post: id, views: getViews(id) }
})