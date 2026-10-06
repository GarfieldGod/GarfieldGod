<script setup lang="ts">
import type { PlayerTrack } from '~/composables/useSiteData'

// 右下角悬浮播放器。必须挂在布局层：Nuxt 客户端路由切换只替换 <slot/>，
// 布局实例是保留的，切页时音乐才不会被打断；放进页面组件里一定会被销毁。
// 另外浏览器禁止有声自动播放，所以这里全部由点击驱动，不做「进站即播」。
const { data: meta } = useSiteMeta()
const player = useAudioPlayer()
const route = useRoute()
const { index, playing, expanded, progress, elapsed, duration, volume, bgmPrompt, current } = player

const audioEl = ref<HTMLAudioElement | null>(null)
const rootEl = ref<HTMLElement | null>(null)

const playlist = computed<PlayerTrack[]>(() => {
  const list = meta.value?.playlist
  return Array.isArray(list) ? (list as PlayerTrack[]) : []
})

// 歌单为空、或后台关掉了开关，就整个不渲染，页面与加这个功能之前完全一致
const visible = computed(() => meta.value?.playerEnabled !== false && playlist.value.length > 0)

watch(playlist, (list) => player.setTracks(list), { immediate: true })

// 真正调 play() 只在这一处：换曲与播放状态两个入口都收敛到这里。
// 成功就回报「自动播放完成」，被浏览器拦下就回报「被拦下」——进文章页试放背景音乐时，
// 后者会触发左侧气泡询问用户；用户手动点播时没有 pending，这两个回报都是空操作。
async function startPlayback() {
  const a = audioEl.value
  if (!a || !playing.value) return
  try {
    await a.play()
    player.bgmStarted()
  } catch (e: any) {
    playing.value = false
    // 只有「浏览器不允许自动播放」才值得问用户要不要播。
    // 地址写错、文件缺失、格式不支持同样会让 play() 失败，那种情况弹气泡也没用，
    // 只会让人以为点了就能放，所以只在 NotAllowedError 时提示。
    if (e?.name === 'NotAllowedError') player.bgmBlocked()
    else if (e?.name) console.warn('[player] 播放失败', e.name, a.currentSrc || a.src)
  }
}

// 离开当前文章后，背景音乐询问气泡就不该继续挂着了。
// 气泡是全局状态，切页不会自己消失——如果这篇没播也没关就跳走，会一直停在右下角。
watch(() => route.path, () => player.dismissBgm())

// 换曲：src 由模板绑定跟着换，这里只负责「本来在播就接着播」
// flush post 是必须的——要等 DOM 把新的 src 写上去再调 play()
watch(current, () => startPlayback(), { flush: 'post' })

// 播放状态是唯一真源：任何入口只改这个值，真正调 play/pause 只在这一处。
// 同样 flush post：切曲时先让 DOM 把新 src 写上去，避免误播上一首。
watch(
  playing,
  (v) => {
    const a = audioEl.value
    if (!a) return
    if (v) {
      // 用户一旦开始播放（气泡点播或手动点播），询问气泡就没必要留着了
      bgmPrompt.value = false
      startPlayback()
    } else {
      a.pause()
    }
  },
  { flush: 'post' },
)

watch(
  volume,
  (v) => {
    if (audioEl.value) audioEl.value.volume = v
  },
  { immediate: true },
)

onMounted(() => {
  const a = audioEl.value
  if (!a) return
  a.volume = volume.value
  // 水合后 playing 可能已经是 true（进文章页请求了背景音乐），但页面 setup 期 ref 还没就绪，
  // 那次 play() 被跳过了，这里补一次
  if (playing.value) startPlayback()
})

// 点面板以外的地方自动收起：面板是浮层，不收起来会一直压着正文。
// 用 pointerdown 而不是 click——正文里按下鼠标准备拖选文字时也能顺带收起，更接近原生浮层。
function onDocPointerDown(e: PointerEvent) {
  if (!expanded.value) return
  const el = rootEl.value
  if (el && !el.contains(e.target as Node)) expanded.value = false
}

onMounted(() => document.addEventListener('pointerdown', onDocPointerDown, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointerDown, true))

function fmt(s: number) {
  const v = Number.isFinite(s) && s > 0 ? s : 0
  const m = Math.floor(v / 60)
  const r = Math.floor(v % 60)
  return `${m}:${r < 10 ? '0' : ''}${r}`
}

const elapsedText = computed(() => fmt(elapsed.value))
const durationText = computed(() => fmt(duration.value))

function syncFromAudio() {
  const a = audioEl.value
  if (!a) return
  elapsed.value = a.currentTime
  duration.value = Number.isFinite(a.duration) ? a.duration : 0
  progress.value = a.duration ? a.currentTime / a.duration : 0
}

function toggle() {
  playing.value = !playing.value
}

function step(delta: number) {
  player.select(index.value + delta)
  playing.value = true
}

function pick(i: number) {
  player.select(i)
  playing.value = true
}

function onSeekClick(e: MouseEvent) {
  const a = audioEl.value
  const el = e.currentTarget as HTMLElement | null
  if (!a || !el || !a.duration) return
  const rect = el.getBoundingClientRect()
  const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
  a.currentTime = frac * a.duration
  syncFromAudio()
}

function onVolumeInput(e: Event) {
  volume.value = Number((e.target as HTMLInputElement).value) / 100
}

// 播放结束时自动下一首；只有一首就停下，避免单曲循环停不下来
function onEnded() {
  if (playlist.value.length < 2) {
    playing.value = false
    return
  }
  step(1)
}
</script>

<template>
  <div v-if="visible" ref="rootEl" class="gp" :class="{ 'is-open': expanded }">
    <!-- 音频元素常驻，切页时不会被卸载，音乐因此可以连续播放 -->
    <audio
      ref="audioEl"
      :src="current?.src"
      preload="metadata"
      @timeupdate="syncFromAudio"
      @loadedmetadata="syncFromAudio"
      @durationchange="syncFromAudio"
      @play="playing = true"
      @pause="playing = false"
      @ended="onEnded"
    />

    <!-- 背景音乐询问：从悬浮球左侧展开，点播放或关掉后消失 -->
    <div v-if="bgmPrompt && !expanded" class="gp__prompt" role="dialog" aria-label="背景音乐">
      <button class="gp__prompt-x" type="button" aria-label="关闭提示" @click="player.dismissBgm()">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
        </svg>
      </button>
      <p class="gp__prompt-text">这篇文章有背景音乐，要播放吗？</p>
      <button class="gp__prompt-play" type="button" aria-label="播放背景音乐" @click="player.acceptBgm()">
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5v11l9-5.5z" /></svg>
      </button>
    </div>

    <div class="gp__panel" :aria-hidden="!expanded">
      <div class="gp__top">
        <span class="gp__cover" aria-hidden="true" />
        <div class="gp__meta">
          <span class="gp__title">{{ current?.title || '未选择曲目' }}</span>
          <span class="gp__artist">{{ current?.artist || '' }}</span>
        </div>
        <button class="gp__btn gp__close" type="button" aria-label="收起播放器" @click="expanded = false">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      <div class="gp__row">
        <button class="gp__btn" type="button" aria-label="上一首" @click="step(-1)">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 3h1.7v10H4zm2.6 5L13 3v10z" /></svg>
        </button>
        <button
          class="gp__btn gp__btn--main"
          type="button"
          :aria-label="playing ? '暂停' : '播放'"
          @click="toggle"
        >
          <svg v-if="playing" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4 2.5h3.2v11H4zm4.8 0H12v11H8.8z" />
          </svg>
          <svg v-else viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5v11l9-5.5z" /></svg>
        </button>
        <button class="gp__btn" type="button" aria-label="下一首" @click="step(1)">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M10.3 3H12v10h-1.7zM3 3l6.4 5L3 13z" /></svg>
        </button>
      </div>

      <button class="gp__bar" type="button" aria-label="调整播放进度" @click="onSeekClick">
        <i :style="{ width: `${progress * 100}%` }" />
      </button>

      <div class="gp__row gp__row--sub">
        <span class="gp__time">{{ elapsedText }} / {{ durationText }}</span>
        <span class="gp__volwrap">
          <input
            class="gp__vol"
            type="range"
            min="0"
            max="100"
            :value="Math.round(volume * 100)"
            aria-label="音量"
            @input="onVolumeInput"
          />
        </span>
      </div>

      <p class="gp__label">播放列表</p>
      <ul class="gp__list">
        <li v-for="(t, i) in playlist" :key="`${t.src}-${i}`">
          <button
            class="gp__item"
            :class="{ 'is-on': i === index }"
            type="button"
            :aria-current="i === index"
            @click="pick(i)"
          >
            <span class="gp__item-title">{{ t.title }}</span>
            <span class="gp__item-artist">{{ t.artist || '' }}</span>
          </button>
        </li>
      </ul>
    </div>

    <button
      class="gp__ball"
      type="button"
      :style="{ '--p': progress }"
      :aria-expanded="expanded"
      :aria-label="expanded ? '收起播放器' : '展开播放器'"
      @click="expanded = !expanded"
    >
      <svg v-if="playing" viewBox="0 0 16 16" fill="currentColor">
        <path d="M4 2.5h3.2v11H4zm4.8 0H12v11H8.8z" />
      </svg>
      <svg v-else viewBox="0 0 16 16" fill="currentColor">
        <path d="M12 2v8.3a2.7 2.7 0 11-1.4-2.4V4.1L6.6 5v6.9A2.7 2.7 0 115.2 9.5V4z" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.gp {
  position: fixed;
  right: 22px;
  bottom: 22px;
  z-index: 90;
  display: grid;
  justify-items: end;
  gap: 12px;
}
.gp audio {
  display: none;
}

/* ===== 悬浮球 ===== */
.gp__ball {
  position: relative;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 0;
  padding: 0;
  background: #111;
  color: #fff;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.28);
  transition: transform 0.18s;
}
.gp__ball:hover {
  transform: translateY(-2px);
}
.gp__ball svg {
  width: 20px;
  height: 20px;
}
/* 播放进度做成球外一圈细环，不额外占地方 */
.gp__ball::before {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  background: conic-gradient(#6d6d6d calc(var(--p, 0) * 360deg), transparent 0);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px));
  pointer-events: none;
}

/* ===== 背景音乐询问气泡：贴着悬浮球左侧展开 ===== */
.gp__prompt {
  position: absolute;
  right: 68px;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  width: 250px;
  padding: 14px;
  background: #fff;
  color: var(--gg-ink);
  border: 1px solid var(--gg-border);
  border-radius: 14px;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.2);
  /* 从右侧（播放器一侧）冒出来、向左铺开 */
  transform-origin: right center;
  animation: gp-prompt-in 0.2s ease-out;
}
@keyframes gp-prompt-in {
  from {
    opacity: 0;
    transform: translateX(14px) scale(0.9);
  }
  to {
    opacity: 1;
    transform: translateX(0) scale(1);
  }
}
/* 关闭的叉放在左上角：气泡是从播放器左边长出来的，出口在这一侧 */
.gp__prompt-x {
  position: absolute;
  top: 6px;
  left: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--gg-muted);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.gp__prompt-x:hover {
  background: var(--gg-surface-2);
  color: var(--gg-ink);
}
.gp__prompt-x svg {
  width: 11px;
  height: 11px;
  display: block;
}
/* 文案在左、播放按钮在右，横向排一行（不是上下堆叠） */
.gp__prompt-text {
  flex: 1;
  min-width: 0;
  margin: 0;
  /* 让开左上角的关闭按钮 */
  padding-left: 20px;
  font-size: 0.82rem;
  line-height: 1.5;
}
.gp__prompt-play {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #111;
  color: #fff;
  cursor: pointer;
  transition: transform 0.15s;
}
.gp__prompt-play:hover {
  transform: scale(1.07);
}
.gp__prompt-play svg {
  width: 15px;
  height: 15px;
}

/* ===== 展开面板 ===== */
.gp__panel {
  width: 306px;
  background: #fff;
  color: var(--gg-ink);
  border: 1px solid var(--gg-border);
  border-radius: 16px;
  box-shadow: 0 22px 48px rgba(0, 0, 0, 0.22);
  padding: 16px;
  transform-origin: bottom right;
  transform: scale(0.94);
  opacity: 0;
  pointer-events: none;
  transition: transform 0.18s, opacity 0.18s;
}
.gp.is-open .gp__panel {
  transform: scale(1);
  opacity: 1;
  pointer-events: auto;
}

.gp__top {
  display: flex;
  align-items: center;
  gap: 12px;
}
.gp__cover {
  flex: none;
  width: 52px;
  height: 52px;
  border-radius: 8px;
  background: linear-gradient(135deg, #2f2f2f, #6b6b6b 45%, #a8a8a8);
}
.gp__meta {
  min-width: 0;
  display: grid;
  gap: 1px;
}
.gp__title {
  font-size: 0.92rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gp__artist {
  font-size: 0.76rem;
  color: var(--gg-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gp__btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--gg-border);
  background: transparent;
  color: var(--gg-ink);
  cursor: pointer;
  transition: opacity 0.15s, border-color 0.15s;
}
.gp__btn:hover {
  border-color: #b4b4b4;
}
.gp__btn svg {
  width: 15px;
  height: 15px;
  display: block;
}
.gp__btn--main {
  width: 42px;
  height: 42px;
  background: #111;
  border-color: #111;
  color: #fff;
}
.gp__btn--main svg {
  width: 17px;
  height: 17px;
}
.gp__close {
  margin-left: auto;
  width: 30px;
  height: 30px;
  border-color: transparent;
}
.gp__close svg {
  width: 13px;
  height: 13px;
}

.gp__row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
}
.gp__row--sub {
  gap: 12px;
}

.gp__bar {
  display: block;
  width: 100%;
  height: 4px;
  margin: 14px 0 0;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: var(--gg-surface-2);
  cursor: pointer;
  position: relative;
}
.gp__bar i {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 999px;
  background: #111;
}
.gp__bar::after {
  content: '';
  position: absolute;
  right: -5px;
  top: 50%;
  width: 11px;
  height: 11px;
  margin-top: -5.5px;
  border-radius: 50%;
  background: #111;
  opacity: 0;
  transition: opacity 0.15s;
}
.gp__bar:hover::after {
  opacity: 1;
}

.gp__time {
  font-size: 0.78rem;
  color: var(--gg-muted);
  font-variant-numeric: tabular-nums;
}
.gp__volwrap {
  margin-left: auto;
}
.gp__vol {
  width: 84px;
  accent-color: #111;
  cursor: pointer;
}

.gp__label {
  margin: 16px 0 6px;
  font-size: 0.7rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--gg-muted);
}
.gp__list {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 168px;
  overflow-y: auto;
}
.gp__item {
  display: flex;
  align-items: baseline;
  gap: 10px;
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  text-align: left;
}
.gp__item:hover {
  background: var(--gg-accent-soft);
}
.gp__item.is-on {
  background: #111;
  color: #fff;
}
.gp__item-title {
  font-size: 0.84rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gp__item-artist {
  margin-left: auto;
  flex: none;
  font-size: 0.74rem;
  opacity: 0.6;
  max-width: 42%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 700px) {
  .gp {
    right: 14px;
    bottom: 14px;
  }
  .gp__panel {
    width: calc(100vw - 28px);
  }
  .gp__prompt {
    width: min(200px, calc(100vw - 100px));
  }
}
/* 偏好减少动效：不做缩放淡入 */
@media (prefers-reduced-motion: reduce) {
  .gp__panel,
  .gp__ball {
    transition: none;
  }
  .gp__prompt {
    animation: none;
  }
}
</style>
