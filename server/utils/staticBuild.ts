// 后台保存内容后自动重建静态站（可选）。
// 默认关闭，只有 GG_STATIC_AUTOBUILD=1 时才启用；开启后由 server/plugins/static-build.ts
// 在写操作成功后排队触发，连续保存合并成一次，且同一时间只跑一个构建。
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const DEBOUNCE_MS = 10_000

let timer: NodeJS.Timeout | null = null
let running = false
let queued = false

export function staticAutoBuildEnabled(): boolean {
  return process.env.GG_STATIC_AUTOBUILD === '1'
}

/** 防抖排队：一段时间内的多次保存只触发最后一次 */
export function scheduleStaticBuild(reason: string): void {
  if (!staticAutoBuildEnabled()) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void runBuild(reason)
  }, DEBOUNCE_MS)
  timer.unref()
}

async function runBuild(reason: string): Promise<void> {
  if (running) {
    queued = true
    return
  }

  const script = resolve(process.cwd(), 'scripts', 'build-static.mjs')
  if (!existsSync(script)) {
    console.warn(`[static] 找不到生成脚本，跳过自动重建：${script}`)
    return
  }

  running = true
  console.log(`[static] 内容变更（${reason}），开始重新生成静态站…`)
  const code = await new Promise<number | null>((done) => {
    const child = spawn(process.execPath, [script], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    })
    child.on('error', (err) => {
      console.error('[static] 自动重建启动失败：', err.message)
      done(null)
    })
    child.on('exit', (code) => done(code))
  })

  if (code === 0) console.log('[static] 静态站已更新')
  else console.error(`[static] 自动重建失败，退出码 ${code}`)
  running = false

  if (queued) {
    queued = false
    void runBuild(`${reason} 之后的变更`)
  }
}