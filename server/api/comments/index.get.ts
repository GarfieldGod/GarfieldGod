export default defineEventHandler((event) => {
  const post = Number(getQuery(event).post)
  if (!Number.isFinite(post)) {
    throw createError({ statusCode: 400, message: '缺少 post 参数' })
  }
  return { comments: listComments(post) }
})