const MAX_AUTHOR = 40
const MAX_EMAIL = 120
const MAX_CONTENT = 2000

// 留言以纯文本保存与渲染，入库前剥离标签，避免存储型 XSS
const stripTags = (s: string) => s.replace(/<[^>]*>/g, '').trim()

export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  const post = Number(body?.post)
  const target = Number.isFinite(post) ? getPost(post) : null
  if (!target) {
    throw createError({ statusCode: 400, message: '文章不存在' })
  }
  // 关掉留言的文章：前台已经不显示面板，这里再拦一道，免得直接调接口还能塞进来
  if (!target.allowComments) {
    throw createError({ statusCode: 403, message: '这篇文章不接受留言' })
  }

  const author = stripTags(String(body?.author ?? '')).slice(0, MAX_AUTHOR)
  const content = stripTags(String(body?.content ?? '')).slice(0, MAX_CONTENT)
  const email = String(body?.email ?? '').trim().slice(0, MAX_EMAIL)

  if (!author) throw createError({ statusCode: 400, message: '请填写昵称' })
  if (!content) throw createError({ statusCode: 400, message: '请填写留言内容' })
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw createError({ statusCode: 400, message: '邮箱格式不正确' })
  }

  const comment = addComment({ post, author, content, email: email || undefined })
  setResponseStatus(event, 201)
  return { comment }
})