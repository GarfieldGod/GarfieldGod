import type { NavPageDTO } from '../../utils/navPages'

export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') || ''
  const page = navPageBySlug(slug)
  if (!page) {
    throw createError({ statusCode: 404, message: '页面不存在' })
  }
  const posts = resolvePagePosts(page)

  // 条目右侧的页面胶囊：文章所属展示页面的标题（项目 → 开发项目）。
  // 排除本页自己（否则每个条目都会带上页面名），也排除首页——首页不作为归属展示。
  const pageLabels: Record<number, string> = {}
  for (const p of listNavPages()) {
    if (p.id !== page.id && !p.isHome) pageLabels[p.id] = p.title
  }

  // 展示类型为「子页面」：把每个子页面的内容竖排成一段总览。
  // 每段只取前 N 条（N = latestLimit），避免子页面多时整页过长，点标题可进子页面看全部。
  const previewLimit = page.latestLimit > 0 ? page.latestLimit : 10
  // 静态正文在这里按格式渲染好再下发：老内容为 HTML、新内容为 Markdown，前台不再各自判断
  const withHtml = (p: NavPageDTO) => ({ ...p, contentHtml: renderPageContent(p.content) })
  const childSections =
    page.layout === 'children'
      ? navChildren(page.id).map((child) => {
          const childPosts = resolvePagePosts(child)
          return {
            page: withHtml(child),
            posts: childPosts.slice(0, previewLimit),
            total: childPosts.length,
          }
        })
      : []

  return {
    page: withHtml(page),
    posts,
    total: posts.length,
    childSections,
    tags: page.tagFilter ? pageTagCounts(page.id) : [],
    pageLabels,
  }
})