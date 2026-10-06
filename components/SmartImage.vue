<script setup lang="ts">
// 图片「准备好了再出现」：加载完成前保持透明，完成后淡入。
//
// 这里用 animation 而不是 transition：卡片上的 img 已经被父级样式设了 transform 过渡，
// transition 会被父级规则整体覆盖（同一个属性只能有一组值），而 animation 与 transition 互不干扰。
// 根元素就是 img，父级的 `.xxx img` 与传入的 class 都能照常生效。
const props = withDefaults(
  defineProps<{
    src: string
    /** 缩略图取不到时回落到原图 */
    fallback?: string
    alt?: string
    /** 首屏关键图用 eager，其余交给浏览器懒加载 */
    eager?: boolean
  }>(),
  { fallback: '', alt: '', eager: false },
)

const el = ref<HTMLImageElement | null>(null)
const shown = ref(false)
// 只回落一次，避免原图也 404 时来回抖动
const fellBack = ref(false)

function reveal() {
  shown.value = true
}

function onError() {
  const node = el.value
  if (node && !fellBack.value && props.fallback && props.fallback !== props.src) {
    fellBack.value = true
    node.src = props.fallback
    return
  }
  // 没有可回落的地址：直接显示，别让图片永久停在透明态
  reveal()
}

onMounted(() => {
  // 图片常常在水合之前就加载完了，那时没人接 load 事件，这里补一次
  if (el.value?.complete) reveal()
})
</script>

<template>
  <img
    ref="el"
    class="smart-image"
    :class="{ 'is-shown': shown }"
    :src="src"
    :alt="alt"
    :loading="eager ? 'eager' : 'lazy'"
    decoding="async"
    @load="reveal"
    @error="onError"
  />
</template>

<style scoped>
.smart-image {
  opacity: 0;
}
.smart-image.is-shown {
  animation: smart-image-in 0.6s ease forwards;
}
@keyframes smart-image-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
/* 偏好减少动效：不做淡入，直接可见 */
@media (prefers-reduced-motion: reduce) {
  .smart-image { opacity: 1; }
  .smart-image.is-shown { animation: none; }
}
</style>