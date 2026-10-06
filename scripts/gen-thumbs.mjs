#!/usr/bin/env node
/**
 * 补齐派生缩略图。
 *
 * 卡片封面引用的是原图旁边的 `<基名>.w720.webp` / `<基名>.w1600.webp`
 * （命名与派生规则见 server/utils/uploads.ts）。新上传的图片由上传接口顺带生成，
 * 存量图片需要一次性回填。
 *
 * 静态站尤其需要：静态托管直接由文件系统提供图片，没有 /uploads 路由可以回落原图，
 * 缺缩略图就是一张坏图，所以发布前必须补齐。
 *
 * 用法：node scripts/gen-thumbs.mjs [--uploads <路径>] [--force]
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const THUMB_WIDTHS = [720, 1600]
const THUMBABLE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif'])
const THUMB_NAME_RE = /\.w\d+\.webp$/i

function splitExt(name) {
  const i = name.lastIndexOf('.')
  return i > 0 ? { base: name.slice(0, i), ext: name.slice(i) } : { base: name, ext: '' }
}

/** 遍历待派生的原图：跳过隐藏目录（回收站）、未认领的暂存目录与派生文件本身 */
function* walkOriginals(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      // posts/_tmp 是没落库的新文章暂存目录，不会被发布
      if (entry.name === '_tmp') continue
      yield* walkOriginals(full)
      continue
    }
    if (THUMB_NAME_RE.test(entry.name)) continue
    if (!THUMBABLE_EXT.has(splitExt(entry.name).ext.toLowerCase())) continue
    yield full
  }
}

/** 遍历全部派生缩略图；同样跳过隐藏目录与暂存目录 */
function* walkDerived(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '_tmp') continue
      yield* walkDerived(full)
      continue
    }
    if (THUMB_NAME_RE.test(entry.name)) yield full
  }
}

export async function generateMissingThumbs(
  uploadsPath,
  { force = false, log = console.log } = {},
) {
  const root = resolve(uploadsPath)
  if (!existsSync(root)) {
    log(`[thumbs] 未找到上传目录，跳过：${root}`)
    return { scanned: 0, generated: 0, skipped: 0, bytes: 0, failed: 0, pruned: 0 }
  }

  let sharp
  try {
    sharp = (await import('sharp')).default
  } catch {
    throw new Error('缺少 sharp 依赖，无法生成缩略图（先执行 npm install）')
  }

  const result = { scanned: 0, generated: 0, skipped: 0, bytes: 0, failed: 0, pruned: 0 }

  // 先清孤儿：原图已被删、派生文件却还在（改名中途失败、手工删图等都会留下），
  // 它们不在媒体库列表里，不主动清就永远不会消失
  for (const derived of walkDerived(root)) {
    const origin = derived.replace(THUMB_NAME_RE, '')
    if (existsSync(origin)) continue
    try {
      rmSync(derived, { force: true })
      result.pruned++
    } catch (err) {
      log(`[thumbs] 孤儿清理失败 ${basename(derived)}：${err.message}`)
    }
  }

  for (const file of walkOriginals(root)) {
    result.scanned++
    const dir = dirname(file)
    const name = basename(file)
    const srcMtime = statSync(file).mtimeMs
    let touched = false

    for (const width of THUMB_WIDTHS) {
      const dest = join(dir, `${name}.w${width}.webp`)
      const destInfo = existsSync(dest) ? statSync(dest) : null
      // 缩略图比原图新就认为是最新的；--force 时无条件重做
      if (!force && destInfo && destInfo.mtimeMs >= srcMtime) continue

      // 单张图损坏 / 格式异常不该让整次发布失败：跳过并记账，
      // 缺的缩略图在动态站由 /uploads 路由回落原图，静态站退化为直接用原图
      try {
        await sharp(file)
          .resize({ width, withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(dest)
        result.bytes += statSync(dest).size
        touched = true
      } catch (err) {
        result.failed++
        log(`[thumbs] 跳过 ${name}（w${width}）：${err.message}`)
      }
    }

    if (touched) result.generated++
    else result.skipped++
  }

  log(
    `[thumbs] 原图 ${result.scanned} 张：新生成 ${result.generated} 张、已最新 ${result.skipped} 张` +
      `（本次写出约 ${(result.bytes / 1024 / 1024).toFixed(1)} MB）` +
      (result.failed ? `，失败 ${result.failed} 项` : '') +
      (result.pruned ? `，清理孤儿 ${result.pruned} 个` : ''),
  )
  return result
}

// 直接执行时才跑 CLI，被 build-static.mjs import 时只提供函数
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  let uploads
  let force = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--uploads') uploads = argv[++i]
    else if (argv[i] === '--force') force = true
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('用法：node scripts/gen-thumbs.mjs [--uploads <路径>] [--force]')
      process.exit(0)
    } else {
      console.error(`[thumbs] 未知参数：${argv[i]}`)
      process.exit(1)
    }
  }

  const target = resolve(rootDir, uploads || process.env.GG_UPLOAD_DIR || join('.data', 'uploads'))
  generateMissingThumbs(target, { force }).catch((err) => {
    console.error(`\n[thumbs] 失败：${err.message}\n`)
    process.exit(1)
  })
}