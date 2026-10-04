<script setup lang="ts">
// 旧版页面的头像查看器：单图或轮播（多图时自动播放 + 左右切换 + 圆点）。
// 三个旧版页面共用；打开时随机挑一张作为起始，与原站行为一致。
const props = defineProps<{
  images: string[]
  open: boolean
  title?: string
}>()
const emit = defineEmits<{ close: [] }>()

const index = ref(0)
const multi = computed(() => props.images.length > 1)
let timer: ReturnType<typeof setInterval> | null = null

function stop() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
function next() {
  if (props.images.length) index.value = (index.value + 1) % props.images.length
}
function prev() {
  if (props.images.length) index.value = (index.value - 1 + props.images.length) % props.images.length
}
function start() {
  stop()
  if (multi.value) timer = setInterval(next, 5000)
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
  else if (e.key === 'ArrowRight') next()
  else if (e.key === 'ArrowLeft') prev()
}

watch(
  () => props.open,
  (open) => {
    if (!import.meta.client) return
    if (open) {
      index.value = props.images.length ? Math.floor(Math.random() * props.images.length) : 0
      start()
      document.addEventListener('keydown', onKey)
      document.body.style.overflow = 'hidden'
    } else {
      stop()
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  },
)

onBeforeUnmount(() => {
  if (!import.meta.client) return
  stop()
  document.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="viewer">
      <div
        v-if="open"
        class="viewer"
        role="dialog"
        aria-modal="true"
        :aria-label="title || '头像查看器'"
        @click.self="emit('close')"
      >
        <p class="viewer__title">{{ title || '❮--- The Cutest Person In The World ----❯' }}</p>

        <div class="viewer__stage">
          <img
            v-for="(src, i) in images"
            :key="src"
            :src="src"
            :class="{ 'is-active': i === index }"
            alt=""
          >

          <template v-if="multi">
            <button class="viewer__nav viewer__nav--prev" type="button" aria-label="上一张" @click="prev">❮</button>
            <button class="viewer__nav viewer__nav--next" type="button" aria-label="下一张" @click="next">❯</button>
            <div class="viewer__dots">
              <button
                v-for="(src, i) in images"
                :key="i"
                class="viewer__dot"
                :class="{ 'is-active': i === index }"
                type="button"
                :aria-label="`第 ${i + 1} 张`"
                @click="index = i"
              />
            </div>
          </template>
        </div>

        <button class="viewer__close" type="button" @click="emit('close')">返回</button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.viewer {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(4, 6, 8, 0.94);
  backdrop-filter: blur(6px);
}
.viewer__title {
  position: absolute;
  top: 24px;
  left: 0;
  right: 0;
  margin: 0;
  text-align: center;
  color: rgba(255, 255, 255, 0.85);
  font-family: var(--gg-serif);
  font-size: clamp(14px, 2.4vw, 22px);
  letter-spacing: 0.12em;
}
.viewer__stage {
  position: relative;
  width: min(92vw, 880px);
  height: min(78vh, 620px);
  overflow: hidden;
  border-radius: 16px;
  background: #0e1216;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6);
}
.viewer__stage img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  opacity: 0;
  transition: opacity 0.6s ease;
}
.viewer__stage img.is-active {
  opacity: 1;
}
.viewer__nav {
  position: absolute;
  top: 50%;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  transform: translateY(-50%);
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 20px;
  cursor: pointer;
  transition: background 0.2s;
}
.viewer__nav:hover {
  background: rgba(0, 0, 0, 0.75);
}
.viewer__nav--prev {
  left: 12px;
}
.viewer__nav--next {
  right: 12px;
}
.viewer__dots {
  position: absolute;
  bottom: 14px;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  gap: 8px;
}
.viewer__dot {
  width: 9px;
  height: 9px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.35);
  cursor: pointer;
  transition: background 0.2s, transform 0.2s;
}
.viewer__dot.is-active {
  background: #a9fff9;
  transform: scale(1.25);
}
.viewer__close {
  position: absolute;
  right: 24px;
  bottom: 24px;
  z-index: 2;
  padding: 8px 18px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 999px;
  background: transparent;
  color: #fff;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}
.viewer__close:hover {
  background: #fff;
  color: #111;
}

.viewer-enter-active,
.viewer-leave-active {
  transition: opacity 0.28s ease;
}
.viewer-enter-from,
.viewer-leave-to {
  opacity: 0;
}

@media (max-width: 560px) {
  .viewer__stage {
    height: min(64vh, 460px);
  }
  .viewer__nav {
    width: 38px;
    height: 38px;
  }
}
</style>