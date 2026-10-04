// 正文/摘要/封面/头图里都可能出现暂存地址，统一按字符串替换
function swapDeep(value: unknown, swap: (s: string) => string): unknown {
  if (value === null || typeof value !== 'object') return value
  return JSON.parse(swap(JSON.stringify(value)))
}

export default defineEventHandler(async (event) => {
  const method = getMethod(event)

  if (method === 'GET') {
    return { posts: listPostsForAdmin() }
  }

  if (method === 'POST') {
    const body = await readBody(event)
    const input = parsePostInput(body)
    const post = createPost(input)

    // 新文章落库前上传的图片暂存在 posts/_tmp/<group>，拿到正式 ID 后认领为
    // posts/<id>，并把正文里已经插入的临时地址一起改写
    if (await adoptPostMedia(body?.mediaGroup, post.id)) {
      const from = `/uploads/posts/_tmp/${String(body.mediaGroup).trim()}/`
      const to = `/uploads/posts/${post.id}/`
      const swap = (value: string) => value.split(from).join(to)
      const saved = updatePost(post.id, {
        ...input,
        content: swap(input.content),
        excerpt: swap(input.excerpt ?? ''),
        featured: input.featured ? swap(input.featured) : null,
        postStyleOptions: swapDeep(input.postStyleOptions, swap),
      })
      setResponseStatus(event, 201)
      return { post: saved ?? post }
    }

    setResponseStatus(event, 201)
    return { post }
  }

  throw createError({ statusCode: 405, message: '不支持的请求方法' })
})