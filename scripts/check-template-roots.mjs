#!/usr/bin/env node
/**
 * 模板根节点检查。
 *
 * Nuxt 的页面过渡（out-in）要求页面组件只有一个根节点：多根时切换路由会渲染失败，
 * 表现为「从这一页点进另一页后白屏，刷新才恢复」。这个约束没有任何工具在守，
 * 本项目已经踩过两次，所以固化成构建期检查——把静默的、只在特定点击路径下才暴露的
 * 运行时故障，变成构建期直接失败的显式错误。
 *
 * 判定规则与 Vue 编译器保持一致：
 *   - 顶层空白文本不算节点（whitespace: 'condense' 会移除）
 *   - 顶层注释不算节点（nuxt.config 的 vue.compilerOptions.comments = false 在编译期丢弃）
 *   - v-if / v-else-if / v-else 链算一个节点（编译器合并为单个条件表达式）
 * 其余顶层节点各算一个根，合计必须恰好为 1。
 *
 * 用法：node scripts/check-template-roots.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from '@vue/compiler-sfc'

const SKIP_DIRS = new Set([
  'node_modules',
  '.nuxt',
  '.output',
  '.static',
  '.data',
  '.git',
  'dist',
])

const NODE_TEXT = 2
const NODE_COMMENT = 3
const NODE_ELEMENT = 1
const NODE_DIRECTIVE = 7

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (name.endsWith('.vue')) out.push(full)
  }
  return out
}

/** v-else-if / v-else 分支属于前面的 v-if 链，不单独计根 */
function isElseBranch(node) {
  return (node.props ?? []).some(
    (p) => p.type === NODE_DIRECTIVE && (p.name === 'else' || p.name === 'else-if'),
  )
}

function countRoots(children) {
  let count = 0
  for (const node of children ?? []) {
    if (node.type === NODE_COMMENT) continue
    if (node.type === NODE_TEXT && !String(node.content ?? '').trim()) continue
    if (node.type === NODE_ELEMENT && isElseBranch(node)) continue
    count++
  }
  return count
}

/** 扫描 rootDir 下所有 .vue，返回 { checked, problems: [{ file, count }] } */
export function checkTemplateRoots(rootDir) {
  const problems = []
  let checked = 0

  for (const file of walk(rootDir)) {
    const { descriptor } = parse(readFileSync(file, 'utf8'), { filename: file })
    const ast = descriptor.template?.ast
    // 没有模板块的组件（纯 render 函数）不适用这条规则
    if (!ast) continue
    checked++
    const count = countRoots(ast.children)
    if (count !== 1) {
      problems.push({ file: relative(rootDir, file).replace(/\\/g, '/'), count })
    }
  }

  return { checked, problems }
}

function describe(count) {
  if (count === 0) return '没有根节点'
  return `${count} 个根节点`
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const { checked, problems } = checkTemplateRoots(rootDir)

  if (problems.length) {
    console.error('\n[check:templates] 以下模板顶层不是恰好一个根节点：\n')
    for (const p of problems) console.error(`  ${p.file}  →  ${describe(p.count)}`)
    console.error(
      '\nNuxt 的页面过渡要求单个根元素，多根会让路由切换渲染失败（白屏、刷新才恢复）。' +
        '\n把多余内容包进一个外层 <div>，或把说明性注释移进 <script setup>。\n',
    )
    process.exit(1)
  }

  console.log(`[check:templates] 通过：${checked} 个模板均为单一根节点`)
}