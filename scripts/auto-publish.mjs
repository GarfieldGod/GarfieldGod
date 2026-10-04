#!/usr/bin/env node
/**
 * 静态站自动发布：检测源站变更 → 生成静态站 → 提交并推送到 GitHub 部署仓库。
 *
 * 变更检测靠「源指纹」：数据库内容表 + 上传目录清单 + 源码文件哈希。
 * 指纹分两级记录（已生成 / 已发布），推送失败时下次只重试推送，不重复生成。
 *
 * 用法：
 *   node scripts/auto-publish.mjs [--force] [--repo <url>] [--dir <路径>]
 *                                 [--branch main] [--out dist] [--db <路径>]
 *                                 [--uploads <路径>] [--base /]
 * 环境变量：GG_DEPLOY_REPO / GG_DEPLOY_DIR / GG_DEPLOY_BRANCH /
 *           GG_GIT_USER_NAME / GG_GIT_USER_EMAIL /
 *           GG_STATIC_BASE_URL / GG_STATIC_DIST / GG_DB_PATH / GG_UPLOAD_DIR
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function fail(msg) {
  console.error(`\n[publish] ${msg}\n`)
  process.exit(1)
}

function log(msg) {
  const t = new Date().toLocaleString('zh-CN', { hour12: false })
  console.log(`[publish] ${t} ${msg}`)
}

// ===== 配置 =====
// 服务器上用 cron 跑，环境变量不会自动带上，这里把 .env 读进来兜底
for (const file of ['.env', '.env.local']) loadEnvFile(resolve(rootDir, file))

const opts = parseArgs(process.argv.slice(2))
if (opts.help) {
  console.log(
    '用法：node scripts/auto-publish.mjs [--force] [--repo <url>] [--dir <路径>]\n' +
      '                                  [--branch main] [--out dist] [--db <路径>]\n' +
      '                                  [--uploads <路径>] [--base /]',
  )
  process.exit(0)
}

const dbPath = resolve(rootDir, opts.db || process.env.GG_DB_PATH || join('.data', 'garfieldgod.db'))
const uploadsPath = resolve(
  rootDir,
  opts.uploads || process.env.GG_UPLOAD_DIR || join('.data', 'uploads'),
)
const distDir = resolve(rootDir, opts.out || process.env.GG_STATIC_DIST || 'dist')
const baseURL = String(opts.base || process.env.GG_STATIC_BASE_URL || '/')
const repo = String(opts.repo || process.env.GG_DEPLOY_REPO || '').trim()
const deployDir = resolve(rootDir, opts.dir || process.env.GG_DEPLOY_DIR || join('.static', 'deploy'))
const branch = String(opts.branch || process.env.GG_DEPLOY_BRANCH || 'main').trim()
const gitName = process.env.GG_GIT_USER_NAME || 'GarfieldGod'
const gitEmail = process.env.GG_GIT_USER_EMAIL || 'garfieldgod@users.noreply.github.com'
const stateFile = resolve(rootDir, '.static', 'publish-state.json')

// 参与指纹的源码范围：模板、样式、服务端、生成脚本，改了就该重新生成
const CODE_DIRS = [
  'assets',
  'components',
  'composables',
  'layouts',
  'pages',
  'public',
  'server',
  'utils',
  'scripts',
]
const CODE_FILES = ['app.vue', 'nuxt.config.ts', 'package.json']

if (!existsSync(dbPath)) fail(`找不到数据库：${dbPath}`)

// ===== 1. 变更检测 =====
const state = readState()
const fingerprint = computeFingerprint()
log(`源指纹 ${fingerprint.slice(0, 12)}（上次已生成 ${short(state.built)}，已发布 ${short(state.published)}）`)

const distReady = existsSync(join(distDir, 'index.html'))
const needBuild = Boolean(opts.force) || !distReady || state.built !== fingerprint
// 换了部署仓库也要重推：已发布状态是按仓库记的
const needPublish =
  Boolean(opts.force) || state.published !== fingerprint || state.publishedRepo !== repo

if (!needBuild && !needPublish) {
  log('源站没有新变化，本次跳过。')
  process.exit(0)
}

// ===== 2. 生成静态站 =====
if (needBuild) {
  log('检测到更新，开始生成静态站…')
  runBuild()
  state.built = fingerprint
  saveState(state)
  log('静态站生成完成。')
} else {
  log('产物已是当前源的最新版本，跳过生成。')
}

// ===== 3. 提交并推送 =====
if (!repo) {
  log('未配置 GG_DEPLOY_REPO，产物已生成到 dist，本次跳过推送。')
  log('配置好仓库地址后重跑本脚本即可推送。')
  process.exit(0)
}

if (!needPublish) {
  log('部署仓库已是最新，无需推送。')
  process.exit(0)
}

const commit = publish()
state.published = fingerprint
state.publishedRepo = repo
state.publishedAt = new Date().toISOString()
saveState(state)
log(`发布完成，提交 ${commit} 已推送到 ${repo}（${branch}）`)

// ===== 实现 =====

function loadEnvFile(file) {
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let value = m[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    // 真实环境变量优先，.env 只补空缺
    if (process.env[m[1]] === undefined) process.env[m[1]] = value
  }
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--force') out.force = true
    else if (a === '--repo') out.repo = argv[++i]
    else if (a === '--dir') out.dir = argv[++i]
    else if (a === '--branch') out.branch = argv[++i]
    else if (a === '--out') out.out = argv[++i]
    else if (a === '--db') out.db = argv[++i]
    else if (a === '--uploads') out.uploads = argv[++i]
    else if (a === '--base') out.base = argv[++i]
    else if (a === '--help' || a === '-h') out.help = true
    else fail(`未知参数：${a}`)
  }
  return out
}

function short(value) {
  return value ? String(value).slice(0, 12) : '无'
}

function readState() {
  try {
    const parsed = JSON.parse(readFileSync(stateFile, 'utf8'))
    return { built: '', published: '', publishedRepo: '', ...parsed }
  } catch {
    return { built: '', published: '', publishedRepo: '' }
  }
}

function saveState(value) {
  mkdirSync(dirname(stateFile), { recursive: true })
  writeFileSync(stateFile, JSON.stringify(value, null, 2), 'utf8')
}

/**
 * 源指纹：凡是会影响静态产物的东西都算进来。
 * 刻意排除 post_views / visit_log —— 它们随访问实时变化，算进去会导致每天无谓重建。
 */
function computeFingerprint() {
  const db = new DatabaseSync(dbPath)
  const dump = (sql) => {
    try {
      return db.prepare(sql).all()
    } catch {
      return []
    }
  }
  const content = {
    site_meta: dump('SELECT key, value FROM site_meta ORDER BY key'),
    posts: dump('SELECT * FROM posts ORDER BY id'),
    nav_pages: dump('SELECT * FROM nav_pages ORDER BY id'),
    post_pages: dump('SELECT post_id, page_id FROM post_pages ORDER BY post_id, page_id'),
    tags: dump('SELECT id, name, page_id, sort_order FROM tags ORDER BY id'),
    post_tags: dump('SELECT post_id, tag_id FROM post_tags ORDER BY post_id, tag_id'),
    // 只有 approved 的评论会进静态页，其余状态不影响产物
    comments: dump(
      "SELECT id, post, author, content, date FROM comments WHERE status = 'approved' ORDER BY id",
    ),
  }
  db.close()

  return sha256(
    JSON.stringify({ content, uploads: listUploads(), code: listCode() }),
  )
}

/** 上传目录清单：文件名 + 体积 + 修改时间，够灵敏也够便宜 */
function listUploads() {
  if (!existsSync(uploadsPath)) return []
  const out = []
  for (const file of walk(uploadsPath)) {
    const rel = toPosix(relative(uploadsPath, file))
    if (rel.split('/').some((seg) => seg.startsWith('.'))) continue
    const st = statSync(file)
    out.push(`${rel}|${st.size}|${Math.round(st.mtimeMs)}`)
  }
  return out.sort()
}

function listCode() {
  const files = []
  for (const dir of CODE_DIRS) {
    const full = resolve(rootDir, dir)
    if (!existsSync(full)) continue
    for (const file of walk(full)) files.push(file)
  }
  for (const name of CODE_FILES) {
    const full = resolve(rootDir, name)
    if (existsSync(full)) files.push(full)
  }
  const map = {}
  for (const file of files) {
    map[toPosix(relative(rootDir, file))] = sha256(readFileSync(file))
  }
  return map
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else yield full
  }
}

function toPosix(path) {
  return path.split(sep).join('/')
}

function sha256(input) {
  return createHash('sha256').update(input).digest('hex')
}

function runBuild() {
  const args = [join(rootDir, 'scripts', 'build-static.mjs')]
  if (opts.out) args.push('--out', opts.out)
  if (opts.db) args.push('--db', opts.db)
  if (opts.uploads) args.push('--uploads', opts.uploads)
  args.push('--base', baseURL)

  const r = spawnSync(process.execPath, args, { cwd: rootDir, stdio: 'inherit' })
  if (r.error) fail(`启动生成脚本失败：${r.error.message}`)
  if (r.status !== 0) fail(`静态生成失败（退出码 ${r.status}）`)
}

function publish() {
  ensureRepo()
  syncTree(distDir, deployDir)

  git(['add', '-A'], deployDir)
  const changed = git(['status', '--porcelain'], deployDir, { capture: true }).stdout.trim()

  if (changed) {
    const message = `chore: 自动更新静态站 ${new Date().toISOString()}`
    git(
      ['-c', `user.name=${gitName}`, '-c', `user.email=${gitEmail}`, 'commit', '-m', message],
      deployDir,
    )
    log('已提交本次产物改动。')
  } else {
    log('产物与上次提交一致，直接推送已有提交。')
  }

  // 无论本次是否产生新提交都要推送：本地可能还留着上次推送失败时的提交
  git(['push', 'origin', branch], deployDir)
  return git(['rev-parse', '--short', 'HEAD'], deployDir, { capture: true }).stdout.trim()
}

/** 准备部署仓库：没有就 init + 关联远端，有就拉回远端状态再覆盖 */
function ensureRepo() {
  const hasGit = existsSync(join(deployDir, '.git'))
  if (!hasGit) {
    rmSync(deployDir, { recursive: true, force: true })
    mkdirSync(deployDir, { recursive: true })
    git(['init'], deployDir)
    git(['checkout', '-B', branch], deployDir)
    git(['remote', 'add', 'origin', repo], deployDir)
  } else {
    const remotes = git(['remote'], deployDir, { capture: true }).stdout.split(/\r?\n/)
    if (!remotes.includes('origin')) git(['remote', 'add', 'origin', repo], deployDir)
    else git(['remote', 'set-url', 'origin', repo], deployDir)
  }

  // 远端为空（刚建的仓库）时 fetch 会失败，按「全新仓库」继续即可
  const fetched =
    git(['fetch', 'origin', branch], deployDir, { allowFail: true, capture: true }).status === 0
  git(['checkout', '-B', branch, ...(fetched ? ['FETCH_HEAD'] : [])], deployDir)
}

/** 用产物内容整体替换工作区，只保留 .git */
function syncTree(src, dest) {
  for (const entry of readdirSync(dest)) {
    if (entry === '.git') continue
    rmSync(join(dest, entry), { recursive: true, force: true })
  }
  cpSync(src, dest, { recursive: true })
}

function git(args, cwd, { allowFail = false, capture = false } = {}) {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
    // cron 里没人能输密码，缺凭据时直接失败，别把进程挂住
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  if (r.error) {
    if (r.error.code === 'ENOENT') fail('未找到 git，请先在服务器上安装 Git')
    fail(`执行 git 失败：${r.error.message}`)
  }
  if (r.status !== 0 && !allowFail) {
    const detail = capture ? `\n${(r.stderr || '').trim()}` : ''
    fail(`git ${args.join(' ')} 失败（退出码 ${r.status}）${detail}`)
  }
  return r
}