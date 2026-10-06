import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: false })

// CommonMark 的 HTML 块会一直吃到空行才结束。老文章正文里常见的 Gutenberg 片段
// （`<figure>…</figure>`）如果后面紧跟着 Markdown（例如新插入的 `![](…)`）而中间没有空行，
// 这段 Markdown 会被当成 HTML 块的一部分原样输出：图片渲染不出来，页面上只留下一行
// `![](…)` 字面文本。这里在块级闭合标签后补一个空行，把 HTML 块与后面的 Markdown 隔开。
// 紧跟另一个标签（嵌套 HTML）、已经是空行、或已到正文末尾时都不动。
const BLOCK_CLOSE =
  /<\/(figure|div|p|section|article|table|ul|ol|blockquote|pre|h[1-6]|iframe|video|audio|details|aside|header|footer|main|nav|form|dl)\s*>/gi

export function separateHtmlBlocks(src: string): string {
  return src.replace(BLOCK_CLOSE, (match, _name, offset: number, whole: string) => {
    const rest = whole.slice(offset + match.length)
    if (!/\S/.test(rest)) return match
    if (/^\s*</.test(rest)) return match
    if (/^[ \t]*\r?\n[ \t]*\r?\n/.test(rest)) return match
    return `${match}\n\n`
  })
}

// 正文按 Markdown 渲染。前台（服务端）与后台实时预览（客户端）共用同一份实现，
// 保证两边结果一致。
export function renderMarkdown(content: string): string {
  if (!content) return ''
  return marked.parse(separateHtmlBlocks(content), { async: false }) as string
}
