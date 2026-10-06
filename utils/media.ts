// 能派生缩略图的图片格式，与服务端 THUMBABLE_EXT 保持一致。
// gif 多为动图（派生会丢动画），视频/音频更不是图片，这些一律用原图。
const THUMBABLE = new Set(['png', 'jpg', 'jpeg', 'webp', 'avif'])

/**
 * 站内媒体地址规范化：把漏了开头斜杠的写法补回来。
 *
 * `uploads/library/2026/10/x.mp3` 在页面 `/post/50` 里会被浏览器当成相对路径，
 * 解析成 `/post/uploads/...`，于是播放/显示一律失败（音频会报 Format error）。
 * 后台是手填地址的输入框，很容易漏掉开头那个斜杠，所以取用处统一兜一层。
 *
 * 外链（http:、https:）、协议相对地址（//host/x）、data URI 与已有 `/` 开头的一律原样返回；
 * 裸文件名不猜目录，保持原样。
 */
export function normalizeMediaSrc(input?: string | null): string {
  const v = (input ?? '').trim()
  if (!v) return ''
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(v)) return v
  if (v.startsWith('/')) return v
  // ./uploads/x.png 这种写法，去掉开头的 ./ 再补根路径
  const rel = v.replace(/^\.\//, '')
  return rel.includes('/') ? `/${rel}` : rel
}

/**
 * 卡片封面等场景用的缩略图地址：`/uploads/a/b.png` → `/uploads/a/b.png.w720.webp`。
 *
 * 派生文件是接在原图全名之后的（见 server/utils/uploads.ts），所以这里只需加后缀，
 * 服务端缺文件时也能从文件名还原出原图路径。
 *
 * 只改 /uploads 下的资源——内置图标、外链、data URI 原样返回；不可派生的格式也原样返回，
 * 这样静态站不会请求到不存在的派生文件。
 */
export function thumbSrc(url?: string | null, width: 720 | 1600 = 720): string {
  const v = (url ?? '').trim()
  if (!v.startsWith('/uploads/')) return v

  const dot = v.lastIndexOf('.')
  // 没有扩展名，或点号落在目录段里（如 /uploads/a.b/name）
  if (dot <= v.lastIndexOf('/')) return v

  const ext = v.slice(dot + 1).toLowerCase()
  if (!THUMBABLE.has(ext)) return v
  return `${v}.w${width}.webp`
}