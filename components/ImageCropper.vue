<script setup lang="ts">
// 头像/图标裁剪：拖动平移、滚轮/滑块缩放，确认后输出正方形 PNG。
// 圆形（头像）与方形（标签图标）共用同一套逻辑，仅遮罩形状不同；圆形由调用方用 border-radius 呈现。
const props = defineProps<{
  /** 待裁剪图片地址（object URL / data URL / 普通 URL） */
  src: string
  /** 输出边长（像素） */
  size?: number
  /** 取景框形状 */
  shape?: 'circle' | 'square'
  /** 确认后由调用方接管，期间禁用按钮避免重复提交 */
  busy?: boolean
}>()

const emit = defineEmits<{
  (e: 'confirm', blob: Blob): void
  (e: 'cancel'): void
}>()

const MAX_ZOOM = 4
const OUT = props.size ?? 512
const shape = computed(() => props.shape ?? 'circle')

const stageEl = ref<HTMLDivElement | null>(null)
const imgEl = ref<HTMLImageElement | null>(null)
// 取景框实际边长由 CSS 决定（窄屏会缩小），这里读取真实值参与换算
const view = ref(320)
const loaded = ref(false)
const processing = ref(false)

const natural = reactive({ w: 0, h: 0 })
const scale = ref(1)
const offset = reactive({ x: 0, y: 0 })
const dragging = ref(false)
let dragStart = { x: 0, y: 0, ox: 0, oy: 0 }

// 短边恰好铺满取景框，再乘用户缩放倍数，保证任何位置都不留白
const baseScale = computed(() => (natural.w && natural.h ? view.value / Math.min(natural.w, natural.h) : 1))
const drawW = computed(() => natural.w * baseScale.value * scale.value)
const drawH = computed(() => natural.h * baseScale.value * scale.value)
const zoom = computed({
  get: () => scale.value,
  set: (v: number) => setScale(v),
})

function clampOffset() {
  offset.x = Math.min(0, Math.max(view.value - drawW.value, offset.x))
  offset.y = Math.min(0, Math.max(view.value - drawH.value, offset.y))
}

function syncView() {
  const w = stageEl.value?.clientWidth
  if (!w || w === view.value) return
  const ratio = w / view.value
  view.value = w
  offset.x *= ratio
  offset.y *= ratio
  clampOffset()
}

function setScale(next: number, cx?: number, cy?: number) {
  const clamped = Math.min(MAX_ZOOM, Math.max(1, next))
  if (clamped === scale.value) return
  const ax = cx ?? view.value / 2
  const ay = cy ?? view.value / 2
  const ratio = clamped / scale.value
  // 以缩放锚点为中心，保持该点在图片上的位置不动
  offset.x = ax - (ax - offset.x) * ratio
  offset.y = ay - (ay - offset.y) * ratio
  scale.value = clamped
  clampOffset()
}

function onLoad() {
  if (!imgEl.value) return
  syncView()
  natural.w = imgEl.value.naturalWidth
  natural.h = imgEl.value.naturalHeight
  scale.value = 1
  offset.x = (view.value - drawW.value) / 2
  offset.y = (view.value - drawH.value) / 2
  clampOffset()
  loaded.value = true
}

function onPointerDown(e: PointerEvent) {
  if (!loaded.value) return
  dragging.value = true
  dragStart = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return
  offset.x = dragStart.ox + (e.clientX - dragStart.x)
  offset.y = dragStart.oy + (e.clientY - dragStart.y)
  clampOffset()
}

function onPointerUp() {
  dragging.value = false
}

function onWheel(e: WheelEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  setScale(scale.value * (e.deltaY < 0 ? 1.08 : 1 / 1.08), e.clientX - rect.left, e.clientY - rect.top)
}

async function confirm() {
  if (!imgEl.value || !loaded.value || processing.value) return
  processing.value = true
  try {
    const s = baseScale.value * scale.value
    const canvas = document.createElement('canvas')
    canvas.width = OUT
    canvas.height = OUT
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建画布上下文')
    ctx.drawImage(imgEl.value, -offset.x / s, -offset.y / s, view.value / s, view.value / s, 0, 0, OUT, OUT)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (blob) emit('confirm', blob)
  } finally {
    processing.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('cancel')
}

onMounted(() => {
  syncView()
  window.addEventListener('resize', syncView)
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', syncView)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div class="cropper" @click.self="emit('cancel')">
      <div class="cropper__panel" role="dialog" aria-modal="true" aria-label="裁剪头像">
        <h2 class="cropper__title">{{ shape === 'circle' ? '裁剪头像' : '裁剪图标' }}</h2>
        <p class="cropper__hint">拖动调整位置，滚轮或滑块缩放</p>

        <div
          ref="stageEl"
          class="cropper__stage"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
          @wheel.prevent="onWheel"
        >
          <img
            ref="imgEl"
            class="cropper__img"
            :src="props.src"
            :style="{ width: `${drawW}px`, height: `${drawH}px`, transform: `translate(${offset.x}px, ${offset.y}px)` }"
            alt=""
            draggable="false"
            @load="onLoad"
          />
          <div class="cropper__mask" :class="`cropper__mask--${shape}`" />
        </div>

        <label class="cropper__zoom">
          <span>缩放</span>
          <input v-model.number="zoom" type="range" min="1" :max="MAX_ZOOM" step="0.01" :disabled="!loaded" />
        </label>

        <div class="cropper__actions">
          <button class="ad-btn" type="button" :disabled="props.busy" @click="emit('cancel')">取消</button>
          <button
            class="ad-btn ad-btn--primary"
            type="button"
            :disabled="!loaded || processing || props.busy"
            @click="confirm"
          >
            {{ processing || props.busy ? '处理中…' : '确认裁剪' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cropper {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.6);
}
.cropper__panel {
  width: min(400px, 100%);
  background: var(--gg-surface);
  border: 1px solid var(--gg-border);
  border-radius: var(--gg-radius);
  padding: 22px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
}
.cropper__title { margin: 0; font-size: 1.15rem; }
.cropper__hint { margin: 6px 0 16px; color: var(--gg-muted); font-size: 0.84rem; }

.cropper__stage {
  position: relative;
  width: 320px;
  height: 320px;
  margin: 0 auto;
  overflow: hidden;
  border-radius: 12px;
  background: #111;
  touch-action: none;
  cursor: grab;
}
.cropper__stage:active { cursor: grabbing; }
.cropper__img {
  position: absolute;
  top: 0;
  left: 0;
  max-width: none;
  user-select: none;
  -webkit-user-drag: none;
}
/* 圆洞/方框遮罩：box-shadow 向四周铺满，把取景范围之外压暗，同时勾出裁剪边界 */
.cropper__mask {
  position: absolute;
  inset: 0;
  border: 2px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55);
  pointer-events: none;
}
.cropper__mask--circle { border-radius: 50%; }
.cropper__mask--square { border-radius: 12px; }

.cropper__zoom {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
  color: var(--gg-inksoft);
  font-size: 0.85rem;
}
.cropper__zoom input { flex: 1; accent-color: var(--gg-ink); }

.cropper__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}

@media (max-width: 420px) {
  .cropper__stage { width: 260px; height: 260px; }
}
</style>
