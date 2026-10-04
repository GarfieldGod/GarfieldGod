export function formatDateCn(value?: string): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

// 摘要里的 <a> 嵌在卡片链接内会形成嵌套 <a>，触发水合报错，直接剥掉
export function cleanExcerpt(html?: string): string {
  if (!html) return ''
  return html.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1')
}

/**
 * 封面地址归一化。
 *
 * 库里存的封面有两种形态：WordPress 导入的老数据是裸文件名（`xxx.jpg`，靠静态目录
 * `/media/` 提供），而后台上传媒体返回的是 `/uploads/2026/09/xxx.png` 这种完整路径。
 * 之前渲染时一律硬拼 `/media/`，于是新上传的封面会被拼成 `/media//uploads/...`，
 * 也就是「设了封面却不显示」。所以渲染前统一过一遍这里。
 *
 * 已经是完整路径（/uploads/...、/media/...）、外链或 data URI 的原样返回；
 * 其余一律视为裸文件名，补上 `/media/` 前缀。
 */
export function coverSrc(value?: string | null): string {
  const v = (value ?? '').trim()
  if (!v) return ''
  if (v.startsWith('/') || v.startsWith('data:') || /^https?:\/\//i.test(v)) return v
  return `/media/${v}`
}