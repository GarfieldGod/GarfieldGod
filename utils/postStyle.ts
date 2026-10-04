// 文章样式方案（前台版式）的共用工具。
// 正文在库里是一段 HTML 字符串，这里只做「给 h2/h3 补锚点 id」「按 h2 切小节」这类轻量处理，
// 前台文章页与后台效果预览都走同一份逻辑，保证两边看到的版式一致。

/**
 * 文章样式方案：'' 默认（原站复刻）/ classic 经典单栏 / toc 左文右栏 /
 * magazine 杂志大图 / cards 分节卡片 / link 超链接（中转页）
 */
export type PostStyleKey = '' | 'classic' | 'toc' | 'magazine' | 'cards' | 'link'

export const POST_STYLE_KEYS: PostStyleKey[] = ['', 'classic', 'toc', 'magazine', 'cards', 'link']

/** 归一化方案 key：不认识的值一律按「默认」处理，老文章因此外观不变 */
export function resolvePostStyle(value?: string | null): PostStyleKey {
  return POST_STYLE_KEYS.includes((value ?? '') as PostStyleKey) ? (value as PostStyleKey) : ''
}

/** 「超链接」方案解析出来的跳转目标 */
export interface LinkTarget {
  /** 规范化后的完整地址，只可能是 http / https */
  url: string
  /** 目标主机名，用于「正在跳转到 xxx」里的展示 */
  host: string
  /** 自动跳转前的等待秒数；0 表示不自动跳，只留按钮 */
  delay: number
}

/** 自动跳转的默认等待秒数 */
export const LINK_DELAY_DEFAULT = 2
/** 等待秒数上限，免得配成一个「等到天荒地老」的值 */
export const LINK_DELAY_MAX = 30

/**
 * 解析「超链接」方案的跳转目标。
 *
 * 只放行 http / https：javascript: 与 data: 这类协议一旦落进 href，就是一个
 * 自己给自己开的 XSS 口子，所以宁可当作「未配置」也不放过去。
 * 没写协议的（如 garfieldgod.cn/xxx）自动补 https://，省得非要手打；
 * 解析不出主机名的一律视为未配置（例如只填了个 /media/x.jpg 这种站内相对路径）。
 *
 * 返回 null 表示这篇文章不该走中转页，前台按普通文章渲染。
 */
export function resolveLinkTarget(
  options?: { linkUrl?: string; linkDelay?: number } | null,
): LinkTarget | null {
  const raw = String(options?.linkUrl ?? '').trim()
  if (!raw) return null

  // 站内相对路径（/media/x.jpg 这类）不是这个方案要的东西：补成 https:// 之后会得到一个
  // 主机名叫 "media" 的假地址，跳过去必然 404，所以直接当未配置。
  // 注意 //host/path 是协议相对地址，仍然放行。
  if (raw.startsWith('/') && !raw.startsWith('//')) return null

  // 已经带协议的（含 javascript: 这类）原样交给 URL 解析，由下面的白名单拦下
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)
  const candidate = hasScheme ? raw : `https://${raw}`

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (!parsed.hostname) return null

  const rawDelay = options?.linkDelay
  const delay =
    typeof rawDelay === 'number' && Number.isFinite(rawDelay)
      ? Math.min(LINK_DELAY_MAX, Math.max(0, Math.floor(rawDelay)))
      : LINK_DELAY_DEFAULT

  return { url: parsed.href, host: parsed.host, delay }
}

export interface PostHeading {
  /** 锚点 id，用于目录 / 小节导航跳转 */
  id: string
  /** 纯文本标题，用于目录条目与导航胶囊 */
  text: string
  level: 2 | 3
}

export interface PreparedPostContent {
  /** 补好锚点 id 的正文 HTML */
  html: string
  /** 正文里的 h2 / h3，按出现顺序 */
  headings: PostHeading[]
}

export interface PostSection {
  id: string
  text: string
  /** 该小节的正文（不含 h2 标题本身），标题由模板单独渲染 */
  html: string
}

const HEADING_RE = /<h([23])\b([^>]*)>([\s\S]*?)<\/h\1>/gi

/** 标题里的标签与实体都清掉，得到可与正文对照的纯文本 */
function headingText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&hellip;|&#8230;/g, '…')
    .replace(/&mdash;|&#8212;/g, '—')
    .replace(/&ndash;|&#8211;/g, '–')
    .replace(/&ldquo;|&#8220;/g, '“')
    .replace(/&rdquo;|&#8221;/g, '”')
    .replace(/&lsquo;|&#8216;/g, '‘')
    .replace(/&rsquo;|&#8217;/g, '’')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * HTML 片段转纯文本：去标签、还原实体、压平空白。
 * 摘要字段（excerpt）在库里常常是带 <p> 的一小段 HTML，直接插值会把标签显示出来，
 * 所以任何要当纯文本用的地方都得先过一遍这里。
 *
 * 另外 WordPress 自动摘要会带一个收尾的 `[&hellip;]` 省略号标记，
 * 还原后是 `[…]`，这里顺手收敛成单个 `…`。
 */
export function postPlainText(html: string): string {
  return decodeEntities((html ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .replace(/\s*\[\s*…\s*\]\s*$/, '…')
    .trim()
}

/**
 * 给正文首个段落打上 lead 类，供杂志大图的「首字下沉」用。
 * 不能只挑没有 class 的段落——WordPress 导出的正文每个 <p> 都带 class="wp-block-paragraph"，
 * 那种写法会一个都挑不中，首字下沉就永远不生效，所以这里直接往首个 <p> 的 class 里追加。
 */
export function markLeadParagraph(html: string): string {
  const src = html ?? ''
  const m = /<p\b([^>]*)>/i.exec(src)
  if (!m) return src
  const attrs = m[1] ?? ''
  let next: string
  if (/\bclass\s*=\s*"([^"]*)"/i.test(attrs)) {
    next = attrs.replace(/\bclass\s*=\s*"([^"]*)"/i, (_, v: string) => `class="${v} lead"`)
  } else if (/\bclass\s*=\s*'([^']*)'/i.test(attrs)) {
    next = attrs.replace(/\bclass\s*=\s*'([^']*)'/i, (_, v: string) => `class='${v} lead'`)
  } else {
    next = `${attrs} class="lead"`
  }
  return src.slice(0, m.index) + `<p${next}>` + src.slice(m.index + m[0].length)
}

function attrId(attrs: string): string {
  const m = /\sid\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs)
  return (m?.[1] ?? m?.[2] ?? '').trim()
}

/**
 * 给正文里的 h2/h3 补上稳定 id（已有 id 的原样保留），并抽出目录。
 * 纯字符串处理，服务端与客户端结果一致，不会造成 hydration 不匹配。
 */
export function preparePostContent(raw: string): PreparedPostContent {
  const src = raw ?? ''
  if (!src || !/[<]h[23][\s>]/i.test(src)) return { html: src, headings: [] }

  const headings: PostHeading[] = []
  let seq = 0
  const html = src.replace(HEADING_RE, (match, lvl: string, attrs: string, inner: string) => {
    const text = headingText(inner)
    if (!text) return match
    const level: 2 | 3 = lvl === '3' ? 3 : 2
    let id = attrId(attrs)
    let out = match
    if (!id) {
      id = `sec-${++seq}`
      out = `<h${lvl}${attrs} id="${id}">${inner}</h${lvl}>`
    }
    headings.push({ id, text, level })
    return out
  })
  return { html, headings }
}

/**
 * 按 h2 把正文切成小节，供「分节卡片」方案使用。
 * 第一个 h2 之前的内容归入 intro；没有 h2 时整篇都算 intro。
 */
export function splitPostSections(prepared: PreparedPostContent): {
  intro: string
  sections: PostSection[]
} {
  const html = prepared.html
  const tops = prepared.headings.filter((h) => h.level === 2)

  const marks: { id: string; text: string; start: number }[] = []
  for (const h of tops) {
    const at = html.indexOf(`id="${h.id}"`)
    if (at < 0) continue
    // 回退到标题标签本身，保证切片不残留半个标签
    const open = html.lastIndexOf('<h2', at)
    marks.push({ id: h.id, text: h.text, start: open < 0 ? at : open })
  }
  if (!marks.length) return { intro: html, sections: [] }

  const intro = html.slice(0, marks[0].start).trim()
  const sections = marks.map((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].start : html.length
    return {
      id: m.id,
      text: m.text,
      html: html
        .slice(m.start, end)
        .replace(/^\s*<h2\b[^>]*>[\s\S]*?<\/h2>/i, '')
        .trim(),
    }
  })
  return { intro, sections }
}

/** 正文纯文本长度，用于估算阅读时长 */
export function postTextLength(raw: string): number {
  return decodeEntities(raw.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, '').length
}
