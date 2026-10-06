#!/usr/bin/env node
/**
 * 静态站点生成器。
 *
 * 以现有 Nuxt 站点（SQLite + 上传目录）为数据源，产出可部署的纯静态目录：
 *   1. 读数据库枚举全部公开路由（首页 / 展示页面 / 已发布文章）
 *   2. 用独立构建目录跑 `nuxi generate`，避免覆盖正在运行的 dev / 生产产物
 *   3. 把上传目录搬进产物（Nuxt 不会自动打包 .data/uploads）
 *   4. 原子替换发布目录
 *
 * 用法：
 *   node scripts/build-static.mjs [--out dist] [--db <路径>] [--uploads <路径>] [--base /]
 * 环境变量：GG_STATIC_DIST / GG_DB_PATH / GG_UPLOAD_DIR / GG_STATIC_BASE_URL
 */
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkTemplateRoots } from './check-template-roots.mjs'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MARKER = '.gg-static'

function fail(msg) {
  console.error(`\n[static] ${msg}\n`)
  process.exit(1)
}

function parseArgs(argv) {
  const opts = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') opts.out = argv[++i]
    else if (a === '--db') opts.db = argv[++i]
    else if (a === '--uploads') opts.uploads = argv[++i]
    else if (a === '--base') opts.base = argv[++i]
    else if (a === '--help' || a === '-h') opts.help = true
    else fail(`未知参数：${a}`)
  }
  return opts
}

const opts = parseArgs(process.argv.slice(2))
if (opts.help) {
  console.log(
    '用法：node scripts/build-static.mjs [--out dist] [--db <路径>] [--uploads <路径>] [--base /]',
  )
  process.exit(0)
}

// 部署子路径：GitHub Pages 项目页是 /<仓库名>/，自定义域名或用户页则是 /
const baseURL = normalizeBase(opts.base || process.env.GG_STATIC_BASE_URL || '/')

const dbPath = resolve(rootDir, opts.db || process.env.GG_DB_PATH || join('.data', 'garfieldgod.db'))
const uploadsPath = resolve(
  rootDir,
  opts.uploads || process.env.GG_UPLOAD_DIR || join('.data', 'uploads'),
)
const distDir = resolve(rootDir, opts.out || process.env.GG_STATIC_DIST || 'dist')
const buildDir = resolve(rootDir, '.static', '.nuxt')
const nitroOut = resolve(rootDir, '.static', '.output')
const routesFile = resolve(rootDir, '.static', 'routes.json')

if (!existsSync(dbPath)) fail(`找不到数据库：${dbPath}`)

// ===== 1. 枚举公开路由 =====
const db = new DatabaseSync(dbPath)
const navRows = db.prepare('SELECT slug, is_home FROM nav_pages').all()
const postRows = db.prepare("SELECT id FROM posts WHERE status = 'published'").all()
db.close()

const routes = new Set(['/'])
// 孤儿页面：不参与后台管理，仅作为固定路由存在；crawlLinks 已关闭，必须显式登记才会生成
const ORPHAN_ROUTES = ['/search', '/oldIndex', '/oldmIndex']
for (const r of ORPHAN_ROUTES) routes.add(r)
let pageCount = 0
for (const row of navRows) {
  const slug = String(row.slug || '').replace(/^\/+|\/+$/g, '')
  if (!slug || slug === 'home' || Number(row.is_home) === 1) continue
  routes.add(`/${slug}`)
  pageCount++
}
let postCount = 0
for (const row of postRows) {
  routes.add(`/post/${row.id}`)
  postCount++
}
const routeList = [...routes].sort()

mkdirSync(dirname(routesFile), { recursive: true })
writeFileSync(routesFile, JSON.stringify(routeList), 'utf8')
console.log(
  `[static] 枚举到 ${routeList.length} 条路由（页面 ${pageCount} + 文章 ${postCount} + 首页 + 孤儿页 ${ORPHAN_ROUTES.length}）`,
)

// ===== 2. 独立目录构建 =====
// 构建前先验模板根节点：多根会让前台路由切换白屏，这种故障只在特定点击路径下暴露，
// 不该等到部署上线后才被发现。
const roots = checkTemplateRoots(rootDir)
if (roots.problems.length) {
  fail(
    `模板根节点检查未通过：${roots.problems
      .map((p) => `${p.file}（${p.count} 个根节点）`)
      .join('、')}；页面过渡要求单个根元素，详见 scripts/check-template-roots.mjs`,
  )
}
console.log(`[static] 模板根节点检查通过（${roots.checked} 个模板）`)

const binName = process.platform === 'win32' ? 'nuxi.cmd' : 'nuxi'
const binPath = join(rootDir, 'node_modules', '.bin', binName)
if (!existsSync(binPath)) fail(`找不到 nuxi：${binPath}（先在项目根目录执行 npm install）`)

console.log('[static] 开始生成（nuxi generate）…')
const build = spawnSync(binPath, ['generate'], {
  cwd: rootDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    GG_STATIC_BUILD_DIR: relative(rootDir, buildDir) || '.nuxt',
    GG_STATIC_NITRO_OUT: relative(rootDir, nitroOut) || '.output',
    GG_STATIC_ROUTES: routesFile,
    GG_STATIC_BASE_URL: baseURL,
  },
})
if (build.error) fail(`启动生成进程失败：${build.error.message}`)
if (build.status !== 0) fail(`nuxi generate 退出码 ${build.status}`)

const publicDir = join(nitroOut, 'public')
if (!existsSync(join(publicDir, 'index.html'))) {
  fail(`未找到生成产物 ${publicDir}/index.html`)
}

// ===== 3. 发布目录：原子替换 =====
// Nuxt 的 generate 结束时会把 dist 建成指向产物目录的软链接/目录联接；
// 我们要的是带媒体的真实目录，所以先把这类链接移除（它指向的产物由本工具生成，可安全替换）。
if (pathExists(distDir) && isLink(distDir)) {
  rmSync(distDir, { recursive: true, force: true })
}

if (pathExists(distDir)) {
  const entries = readdirSync(distDir)
  if (entries.length > 0 && !entries.includes(MARKER)) {
    fail(
      `输出目录已存在且非本工具生成：${distDir}\n` +
        '为避免误删你的文件，请先清空它，或用 --out 指定别的目录。',
    )
  }
}

// 暂存与备份都放在 .static 下（该目录不参与 dev 监视），
// 最后再原子换到发布目录，避免 dev server 的文件监视锁住产物目录。
const stageDir = resolve(rootDir, '.static', 'publish')
const backupDir = resolve(rootDir, '.static', 'publish-old')

rmSync(stageDir, { recursive: true, force: true })
mkdirSync(stageDir, { recursive: true })
cpSync(publicDir, stageDir, { recursive: true })

// 上传目录不在 public/ 里，Nuxt 不会带上，需要单独搬进产物
let mediaCount = 0
if (existsSync(uploadsPath)) {
  mediaCount = copyUploads(uploadsPath, join(stageDir, 'uploads'))
} else {
  console.warn(`[static] 未找到上传目录，跳过媒体复制：${uploadsPath}`)
}

// 正文里的图片写的是 /uploads/… 绝对路径，Nuxt 的 baseURL 管不到这些字符串，
// 部署到子路径时必须自己补上前缀，否则图片全 404。
if (baseURL !== '/') rewriteUploadUrls(stageDir, baseURL)

// GitHub Pages 默认用 Jekyll 处理，会忽略 _nuxt/、_payload.json 这类下划线开头的文件，
// 必须放一个 .nojekyll 关掉它（对其它静态托管无副作用）。
writeFileSync(join(stageDir, '.nojekyll'), '', 'utf8')

writeFileSync(join(stageDir, MARKER), `${new Date().toISOString()}\n`, 'utf8')

// 先把旧目录挪到备份位，再换上新目录；换失败时把旧目录放回去，
// 保证任何时刻线上目录要么是旧的、要么是新的，不会两头空。
rmSync(backupDir, { recursive: true, force: true })
const hadOld = pathExists(distDir)
try {
  if (hadOld) retry(() => renameSync(distDir, backupDir))
  retry(() => renameSync(stageDir, distDir))
} catch (err) {
  if (hadOld && !pathExists(distDir)) {
    try {
      renameSync(backupDir, distDir)
    } catch {
      // 回滚也失败时保留备份目录，便于人工恢复
    }
  }
  fail(`替换发布目录失败：${err.message}`)
}
rmSync(backupDir, { recursive: true, force: true })

// ===== 4. 校验与汇总 =====
const missing = routeList.filter((r) => !existsSync(routeToFile(distDir, r)))
const { files, bytes } = measure(distDir)

console.log('\n[static] 完成')
console.log(`  发布目录：${distDir}`)
console.log(`  路由：${routeList.length - missing.length}/${routeList.length} 已生成`)
console.log(`  文件：${files} 个，合计 ${(bytes / 1024 / 1024).toFixed(1)} MB`)
console.log(`  媒体：${mediaCount} 个文件来自 ${uploadsPath}`)

if (missing.length) {
  console.warn(`[static] 以下路由没有生成 HTML：\n  ${missing.join('\n  ')}`)
  process.exit(1)
}

function routeToFile(base, route) {
  const clean = route.replace(/^\/+/, '').replace(/\/+$/, '')
  return clean ? join(base, clean, 'index.html') : join(base, 'index.html')
}

/** 部署子路径：统一成 / 或 /xxx/ 形式 */
function normalizeBase(value) {
  const v = String(value || '/').trim()
  if (!v || v === '/') return '/'
  return `/${v.replace(/^\/+|\/+$/g, '')}/`
}

/**
 * 把产物里以 "/uploads/ 开头的绝对地址补上部署子路径前缀。
 * 只匹配紧跟在引号或括号后的 /uploads/，不会碰 Nuxt 已经加过前缀的 /<base>/…
 */
function rewriteUploadUrls(dir, base) {
  const re = /(["'(])\/uploads\//g
  let changed = 0
  for (const file of walkFiles(dir)) {
    if (!/\.(html|json)$/i.test(file)) continue
    const text = readFileSync(file, 'utf8')
    const next = text.replace(re, (_m, quote) => quote + base + 'uploads/')
    if (next !== text) {
      writeFileSync(file, next, 'utf8')
      changed++
    }
  }
  console.log(`[static] 子路径 ${base}：已改写 ${changed} 个文件里的 /uploads 地址`)
}

/** 存在性判断：不跟随链接，断链也算存在 */
function pathExists(path) {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

function isLink(path) {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

/** Windows 上目录偶尔会被监视/杀毒程序短暂占用，重试几次再放弃 */
function retry(fn, attempts = 6) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      return fn()
    } catch (err) {
      lastErr = err
      sleepSync(200 * (i + 1))
    }
  }
  throw lastErr
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function copyUploads(src, dest) {
  const root = resolve(src)
  cpSync(root, dest, {
    recursive: true,
    filter: (path) => {
      const rel = relative(root, resolve(path))
      if (!rel) return true
      // 回收站等以点开头的目录不对外发布
      return !rel.split(sep).some((seg) => seg.startsWith('.'))
    },
  })
  return measure(dest).files
}

function* walkFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walkFiles(full)
    else yield full
  }
}

function measure(dir) {
  let files = 0
  let bytes = 0
  for (const file of walkFiles(dir)) {
    files++
    bytes += statSync(file).size
  }
  return { files, bytes }
}