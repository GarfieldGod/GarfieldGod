// 批量导出：把勾选的文章按各自 format 打成 .md / .html，装进一个 zip 下载。
// 放在服务端做的好处是直接读库、不用把每篇正文再拉一遍到浏览器，也不用给前端加打包库。
import { getPostForAdmin, type AdminPost } from '../../../utils/admin'
import { buildZip, type ZipEntry } from '../../../utils/zip'

const BAD_FILENAME = /[\\/:*?"<>|\u0000-\u001f]/g

function safeBaseName(title: string, id: number): string {
  const base = title.replace(BAD_FILENAME, '_').replace(/\s+/g, ' ').trim().slice(0, 80)
  return base || `post-${id}`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** front-matter 的写法与批量导入的解析器对齐（title / date / tags 可原样读回） */
function markdownFile(post: AdminPost): string {
  const lines = [
    '---',
    `title: ${post.title.replace(/\s+/g, ' ')}`,
    `date: ${post.date}`,
    `pages: ${post.pages.map((p) => p.title).join('、')}`,
    `tags: ${post.tags.map((t) => t.name).join(',')}`,
    '---',
    '',
  ]
  return `${lines.join('\n')}${post.content}\n`
}

/** 老文章正文是 WordPress 片段，单独成篇时补一层可读的最小骨架 */
function htmlFile(post: AdminPost): string {
  const body = post.content
  if (/^\s*<(?:!doctype|html)\b/i.test(body)) return body
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(post.title)}</title>
<style>
  body { margin: 0; padding: 2.5rem 1.25rem; background: #fafafa; color: #1a1a1a; }
  article { max-width: 46rem; margin: 0 auto; line-height: 1.75; font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
  img, video { max-width: 100%; height: auto; }
  pre { overflow: auto; padding: 1rem; background: #f0f0f0; border-radius: 8px; }
  blockquote { margin: 1.5rem 0; padding-left: 1rem; border-left: 3px solid #ccc; color: #555; }
</style>
</head>
<body>
<article>
${body}
</article>
</body>
</html>
`
}

export default defineEventHandler((event) => {
  const ids = [
    ...new Set(
      String(getQuery(event).ids ?? '')
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  ]
  if (!ids.length) throw createError({ statusCode: 400, message: '请先勾选要导出的文章' })

  const posts = ids
    .map((id) => getPostForAdmin(id))
    .filter((p): p is AdminPost => p !== null)
  if (!posts.length) throw createError({ statusCode: 404, message: '所选文章都不存在' })

  const entries: ZipEntry[] = []
  const used = new Map<string, number>()
  for (const post of posts) {
    const ext = post.format === 'markdown' ? 'md' : 'html'
    const base = safeBaseName(post.title, post.id)
    const key = `${base}.${ext}`
    const seen = used.get(key) ?? 0
    used.set(key, seen + 1)
    entries.push({
      name: seen === 0 ? key : `${base}-${seen + 1}.${ext}`,
      data: post.format === 'markdown' ? markdownFile(post) : htmlFile(post),
    })
  }

  const zip = buildZip(entries)
  const stamp = new Date().toISOString().slice(0, 10)
  setHeader(event, 'Content-Type', 'application/zip')
  setHeader(event, 'Content-Disposition', `attachment; filename="garfieldgod-posts-${stamp}.zip"`)
  setHeader(event, 'Content-Length', String(zip.length))
  setHeader(event, 'Cache-Control', 'no-store')
  return zip
})