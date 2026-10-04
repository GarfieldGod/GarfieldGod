// 后台写操作成功后，排队触发一次静态站重建。
// 仅在 GG_STATIC_AUTOBUILD=1 时挂载，默认不影响任何请求。
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export default defineNitroPlugin((nitroApp) => {
  if (!staticAutoBuildEnabled()) return

  nitroApp.hooks.hook('afterResponse', (event) => {
    let method = ''
    let path = ''
    try {
      method = getMethod(event).toUpperCase()
      path = getRequestURL(event).pathname
    } catch {
      return
    }

    if (!MUTATING_METHODS.has(method)) return
    if (!path.startsWith('/api/admin/')) return
    // 登录 / 登出不属于内容变更
    if (path.startsWith('/api/admin/session')) return

    scheduleStaticBuild(`${method} ${path}`)
  })
})