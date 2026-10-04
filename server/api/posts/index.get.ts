function toInt(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined
}

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const pageSlug = typeof q.page === 'string' ? q.page : undefined

  let pageId: number | undefined
  if (pageSlug) {
    const page = navPageBySlug(pageSlug)
    if (!page) {
      throw createError({ statusCode: 404, message: '页面不存在' })
    }
    pageId = page.id
  }

  const posts = listPosts({
    limit: toInt(q.limit),
    offset: toInt(q.offset),
    pageId,
  })
  return { posts, total: countPosts({ pageId }) }
})