// 网站图标自动获取：抓目标页面里的 <link rel="icon">，下载后转成 PNG 存进媒体库。
// 只在后台「自动获取图标」按钮里调用；接口位于 /api/admin 下，由 admin-guard 统一鉴权。
//
// 安全边界（这是服务端主动访问用户填写的地址，必须当成 SSRF 入口来防）：
//   - 只放行 http/https，禁止 URL 里带账号密码，端口只允许 80/443；
//   - 每一跳（含重定向）都解析主机并检查 IP，拦截回环、内网、云元数据地址；
//   - 限制重定向次数、单次超时与响应体积，避免被慢响应或超大文件拖住。
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { join } from 'node:path'
import { libraryDir, storeUpload } from './uploads'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const MAX_HTML_BYTES = 1 * 1024 * 1024
const MAX_ICON_BYTES = 2 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 8000
const TOTAL_TIMEOUT_MS = 15000
const MAX_REDIRECTS = 5

export interface FetchedIcon {
  /** 转存后的站内地址，可直接填进「图标」输入框 */
  icon: string
  /** 实际取到图标的目标地址，便于排查 */
  source: string
}

function fail(message: string): never {
  throw new Error(message)
}

/** 判断解析出来的 IP 是否属于本机 / 内网 / 保留段 */
function isPrivateIp(ip: string): boolean {
  const version = isIP(ip)
  if (version === 4) {
    const [a, b] = ip.split('.').map(Number)
    if (!Number.isFinite(a) || !Number.isFinite(b)) return true
    if (a === 0 || a === 127) return true
    if (a === 10) return true
    if (a === 169 && b === 254) return true // 链路本地，含云元数据 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true // 运营商级 NAT
    if (a >= 224) return true // 组播与保留段
    return false
  }
  if (version === 6) {
    const v = ip.toLowerCase()
    if (v === '::1' || v === '::') return true
    if (v.startsWith('fc') || v.startsWith('fd')) return true // fc00::/7
    if (/^fe[89ab]/.test(v)) return true // fe80::/10
    if (v.startsWith('ff')) return true // 组播
    return false
  }
  return true
}

/** 校验地址合法且指向公网，返回解析后的 URL */
async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    fail('网站链接格式不正确')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') fail('只支持 http/https 链接')
  if (url.username || url.password) fail('链接不能包含账号密码')
  if (url.port && url.port !== '80' && url.port !== '443') fail('只允许标准端口（80/443）')

  const host = url.hostname
  if (!host) fail('网站链接缺少域名')

  // 显式写 IP 时直接判断；域名则解析全部记录，任一落在内网都拒绝
  if (isIP(host)) {
    if (isPrivateIp(host)) fail('不允许访问内网地址')
    return url
  }

  let addresses: { address: string }[]
  try {
    addresses = await lookup(host, { all: true, verbatim: true })
  } catch {
    fail('域名解析失败')
  }
  if (!addresses.length) fail('域名解析失败')
  if (addresses.some((item) => isPrivateIp(item.address))) fail('不允许访问内网地址')
  return url
}

interface Fetched {
  res: Response
  /** 跟随重定向后的真实地址，用于解析相对路径 */
  url: URL
}

/** 逐跳手动跟随重定向，每一跳都重新做公网校验 */
async function fetchWithRedirects(url: URL): Promise<Fetched> {
  const deadline = Date.now() + TOTAL_TIMEOUT_MS
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const remain = deadline - Date.now()
    if (remain <= 0) fail('获取图标超时')
    const res = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remain)),
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    }).catch(() => fail('访问网站失败'))

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      await res.body?.cancel().catch(() => {})
      if (!location) fail('网站返回了无效的重定向')
      const next = new URL(location, current)
      await assertPublicUrl(next.href)
      current = next
      continue
    }
    return { res, url: current }
  }
  fail('重定向次数过多')
}

/** 按上限读取响应体，超限直接中断，避免大文件占满内存 */
async function readLimited(res: Response, max: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => {})
    fail('响应内容过大')
  }
  if (!res.body) fail('响应内容为空')

  const reader = res.body.getReader()
  const chunks: Buffer[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > max) {
        await reader.cancel().catch(() => {})
        fail('响应内容过大')
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks)
}

function decodeEntities(raw: string): string {
  return raw
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
}

function attr(tag: string, name: string): string {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  return decodeEntities((match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim())
}

interface Candidate {
  url: string
  score: number
}

/**
 * 从 HTML 里抽出图标候选并按质量排序：
 * apple-touch-icon > 普通 icon/shortcut icon，同类型下 sizes 越大越优先。
 */
function extractCandidates(html: string, base: URL): Candidate[] {
  const out: Candidate[] = []
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attr(tag, 'rel').toLowerCase()
    if (!rel) continue
    const href = attr(tag, 'href')
    if (!href) continue

    let baseScore = 0
    if (rel.includes('apple-touch-icon')) baseScore = 200
    else if (rel.split(/\s+/).includes('icon')) baseScore = 100
    else continue

    let size = 0
    for (const token of attr(tag, 'sizes').split(/\s+/)) {
      const m = /(\d+)x(\d+)/i.exec(token)
      if (m) size = Math.max(size, Math.min(Number(m[1]), Number(m[2])))
      else if (token.toLowerCase() === 'any') size = Math.max(size, 256)
    }

    try {
      const url = new URL(href, base)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
      out.push({ url: url.href, score: baseScore + size })
    } catch {
      // 畸形 href 直接跳过
    }
  }
  out.sort((a, b) => b.score - a.score)

  // 去重但保留排序
  const seen = new Set<string>()
  return out.filter((item) => {
    if (seen.has(item.url)) return false
    seen.add(item.url)
    return true
  })
}

const ICON_EXT = /\.(ico|png|svg|jpe?g|webp|gif|avif)$/i

/** 下载单个候选图标，能栅格化就统一转 PNG；ICO 浏览器可直接渲染，原样保留 */
async function downloadIcon(url: string): Promise<{ data: Buffer; ext: string; mime: string } | null> {
  const target = await assertPublicUrl(url)
  const { res } = await fetchWithRedirects(target)
  if (!res.ok) {
    await res.body?.cancel().catch(() => {})
    return null
  }

  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  const isImage = type.startsWith('image/') || ICON_EXT.test(target.pathname)
  if (!isImage) {
    await res.body?.cancel().catch(() => {})
    return null
  }

  const raw = await readLimited(res, MAX_ICON_BYTES)
  if (!raw.length) return null

  // SVG 有被栅格化的价值（可任意放大且无栅格噪点），其他位图统一压到 128px
  try {
    const sharp = (await import('sharp')).default
    const png = await sharp(raw, { density: 300 })
      .resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()
    return { data: png, ext: 'png', mime: 'image/png' }
  } catch {
    // sharp 不支持 ICO；这类原样存下即可，浏览器 <img> 能正常显示
    if (type === 'image/x-icon' || type === 'image/vnd.microsoft.icon' || /\.ico$/i.test(target.pathname)) {
      return { data: raw, ext: 'ico', mime: 'image/x-icon' }
    }
    return null
  }
}

function hostSlug(url: URL): string {
  return url.hostname.replace(/[^\w-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'site'
}

/** 存进媒体库（按年/月分层，与后台媒体库上传保持一致） */
async function storeIcon(data: Buffer, ext: string, mime: string, slug: string): Promise<string> {
  const now = new Date()
  const rel = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`
  const dir = join(libraryDir(), rel)
  const stored = await storeUpload(dir, `site-icon-${slug}.${ext}`, mime, data)
  return `/uploads/library/${rel}/${stored.name}`
}

/**
 * 抓取网站图标并转存到本站媒体库。
 * 先读页面里的 icon 声明，再兜底试 /favicon.ico；全部失败时抛错，由调用方提示手动上传。
 */
export async function fetchSiteIcon(rawUrl: string): Promise<FetchedIcon> {
  const page = await assertPublicUrl(rawUrl)

  const candidates: string[] = []
  let base = page
  try {
    const { res, url } = await fetchWithRedirects(page)
    base = url
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    // 只解析 HTML；另外没声明 content-type 的也当 HTML 试一把
    if (res.ok && (type === '' || type.includes('html') || type.includes('xml'))) {
      const html = (await readLimited(res, MAX_HTML_BYTES)).toString('utf8')
      candidates.push(...extractCandidates(html, base).map((item) => item.url))
    } else {
      await res.body?.cancel().catch(() => {})
    }
  } catch {
    // 页面抓不到（反爬、超时、证书问题等）不影响后面直接试 favicon.ico
  }

  // 兜底：站点根目录的 favicon.ico（绝大多数站点都会放一个）
  const fallback = new URL('/favicon.ico', base.origin).href
  if (!candidates.includes(fallback)) candidates.push(fallback)

  const slug = hostSlug(page)
  for (const candidate of candidates.slice(0, 6)) {
    try {
      const icon = await downloadIcon(candidate)
      if (!icon) continue
      return { icon: await storeIcon(icon.data, icon.ext, icon.mime, slug), source: candidate }
    } catch {
      // 单个候选失败就换下一个
    }
  }

  fail('未能从该网站获取到图标，请手动上传或填写图标地址')
}
