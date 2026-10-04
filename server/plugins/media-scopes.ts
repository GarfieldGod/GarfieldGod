// 启动时跑一次存量媒体分流（已跑过会直接返回 null）。
// 失败只记日志，不拦住服务启动——媒体归类有问题不该导致整站起不来。
export default defineNitroPlugin(async () => {
  try {
    const res = await migrateMediaScopes()
    if (res) {
      console.log(
        `[media] 存量媒体分流完成：${res.moved} 个文件（文章私有 ${res.toPosts} / 媒体库 ${res.toLibrary}），改写 ${res.rewritten} 条记录`,
      )
    }
  } catch (err) {
    console.error('[media] 存量媒体分流失败，文件与引用保持原样：', err)
  }
})