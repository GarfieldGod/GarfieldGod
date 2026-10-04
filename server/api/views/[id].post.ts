export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || !getPost(id)) {
    throw createError({ statusCode: 404, message: '文章不存在' })
  }
  return { post: id, views: incrementViews(id) }
})