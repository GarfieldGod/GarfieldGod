import { existsSync, readFileSync } from 'node:fs'

// 静态生成模式（scripts/build-static.mjs 调用）：
// 由生成器从数据库枚举出所有公开路由写入清单文件，这里读回来交给 prerender。
// 普通 dev / build 不设置这些变量，行为与原来完全一致。
const staticRoutesFile = process.env.GG_STATIC_ROUTES
let staticRoutes: string[] = []
if (staticRoutesFile && existsSync(staticRoutesFile)) {
  try {
    staticRoutes = JSON.parse(readFileSync(staticRoutesFile, 'utf8'))
  } catch {
    console.warn('[static] 路由清单解析失败，按不预渲染处理：', staticRoutesFile)
  }
}

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  // 静态生成时用独立构建目录，避免与正在运行的 dev / 生产产物互相覆盖
  buildDir: process.env.GG_STATIC_BUILD_DIR || '.nuxt',
  // 产物目录与生成器工作目录不参与 dev 监视：否则替换 dist 时会被文件监视锁住（Windows EPERM）
  ignore: ['**/dist/**', '**/.static/**'],
  vite: {
    server: {
      watch: {
        ignored: ['**/dist/**', '**/.static/**'],
      },
    },
  },
  css: ['~/assets/css/main.css', '~/assets/css/admin.css'],
  nitro: {
    output: { dir: process.env.GG_STATIC_NITRO_OUT || '.output' },
    prerender: {
      routes: staticRoutes,
      // 路由已显式枚举，不靠爬链接，产物更可控
      crawlLinks: false,
      // 后台页面不参与静态生成
      ignore: ['/admin'],
    },
  },
  app: {
    // 部署在子路径（如 GitHub Pages 项目页 /<repo>/）时由生成器传入，默认根路径
    baseURL: process.env.GG_STATIC_BASE_URL || '/',
    // 页面切换淡入淡出（out-in 避免新旧页面同时占位导致跳动）
    pageTransition: { name: 'fade', mode: 'out-in' },
    head: {
      title: 'GarfieldGod — I\'m God.',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        {
          name: 'description',
          content: "GarfieldGod（神加菲尔德）的个人主页：开发项目、绘画作品与随想日志。",
        },
      ],
      link: [
        // 与 layouts/default.vue 中的动态图标共用 key，后台改图标后可覆盖此处默认值
        { rel: 'icon', key: 'favicon', href: '/uploads/library/59-cropped-1-2.jpg' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Source+Serif+Pro:ital,wght@0,400;0,700;0,900;1,400&display=swap',
        },
      ],
    },
  },
})