export default defineEventHandler(async (event) => {
  const method = getMethod(event)

  if (method === 'GET') {
    // tags 供文章编辑器按展示页面分组渲染标签勾选框
    return { pages: listNavPagesForAdmin(), tags: listAllTags() }
  }

  if (method === 'POST') {
    const page = createNavPage(await readBody(event))
    setResponseStatus(event, 201)
    return { page }
  }

  throw createError({ statusCode: 405, message: '不支持的请求方法' })
})