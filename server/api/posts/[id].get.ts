export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, message: '无效的文章 ID' })
  }
  const post = getPost(id)
  if (!post) {
    throw createError({ statusCode: 404, message: '文章不存在' })
  }
  // 正文按 format 在服务端渲染好，前端不必为 Markdown 引入解析库
  return { post: { ...post, html: renderContent(post.content, post.format) } }
})