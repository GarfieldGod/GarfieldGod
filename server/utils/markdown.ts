import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: false })

// 正文按 format 渲染：老文章仍是 Gutenberg HTML，新文章走 Markdown
export function renderContent(content: string, format: string): string {
  if (!content) return ''
  if (format !== 'markdown') return content
  return marked.parse(content, { async: false })
}

// 静态页面正文没有 format 列：老内容来自 WordPress（HTML），新内容在后台按 Markdown 编辑。
// 以 '<' 开头视为 HTML 原样输出，其余按 Markdown 渲染。
export function renderPageContent(content: string): string {
  if (!content) return ''
  return content.trimStart().startsWith('<') ? content : marked.parse(content, { async: false })
}
