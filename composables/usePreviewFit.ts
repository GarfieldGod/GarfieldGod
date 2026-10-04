// 预览画布用「固定参考宽度 + zoom 缩放」复刻前台页面（参考宽度固定，前台卡片才不会变形）。
// 要让画布在任意面板宽度下都恰好铺满、不留侧边空白，zoom 必须 = 可用宽度 / 参考宽度。
// zoom 不接受容器查询单位（cqw），所以这里用 ResizeObserver 实测面板宽度动态计算。
// 用法：在画布元素上挂 ref="el" 即可；CSS 里的 zoom 作为首帧 / SSR 兜底值，
// 客户端挂载后用实测值覆盖（直接写 style，不走响应式，避免多余 re-render 与闪烁）。
export function usePreviewFit(referenceWidth: number) {
  const el = ref<HTMLElement | null>(null)

  function fit() {
    const node = el.value
    const box = node?.parentElement
    if (!node || !box) return
    // box-sizing 是 border-box：clientWidth 已含 padding/border，减去左右 padding 即内容区宽度
    const cs = getComputedStyle(box)
    const avail = box.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)
    if (avail > 0) node.style.zoom = (avail / referenceWidth).toFixed(4)
  }

  onMounted(() => {
    fit()
    const box = el.value?.parentElement
    if (box) {
      const ro = new ResizeObserver(fit)
      ro.observe(box)
      ;(el.value as any).__fitRO = ro
    }
    window.addEventListener('resize', fit)
  })

  onBeforeUnmount(() => {
    ;(el.value as any)?.__fitRO?.disconnect()
    window.removeEventListener('resize', fit)
  })

  return { el }
}
