#!/usr/bin/env node
/**
 * 本地预览静态产物。
 *
 * 静态站的资源都用绝对路径（/_nuxt/…、/uploads/…），
 * 所以必须用 HTTP 服务打开，不能直接双击 dist/index.html（file:// 下会没图、没样式）。
 *
 * 用法：node scripts/serve-static.mjs [目录] [端口]   （默认 dist 4173）
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const root = process.argv[2] || 'dist'
const port = Number(process.argv[3] || 4173)

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
}

createServer(async (req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
  let file = join(root, normalize(urlPath).replace(/^(\.\.[/\\])+/, ''))
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html')
  } catch {
    // 不存在时走下面的 404
  }
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': types[extname(file).toLowerCase()] || 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('404')
  }
}).listen(port, () => {
  console.log(`静态站预览：http://localhost:${port}/  （目录 ${root}）`)
})