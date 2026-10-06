<script setup lang="ts">
import { sessionCachedData } from '~/composables/useSiteData'

definePageMeta({ layout: 'admin' })
useHead({ title: '站点信息 — GarfieldGod 后台' })

interface SiteMetaShape {
  title?: string
  tagline?: string
  url?: string
  tabTitle?: string
  tabTagline?: string
  avatar?: string
  favicon?: string
  playlist?: { title?: string; artist?: string; src?: string }[]
  playerEnabled?: boolean
}

/** 歌单里的一行。uid 只用于列表 key，避免排序时输入框焦点跟着串位 */
interface TrackRow {
  uid: number
  title: string
  artist: string
  src: string
}

let trackUid = 0
function makeTrack(source?: { title?: string; artist?: string; src?: string }): TrackRow {
  trackUid += 1
  return {
    uid: trackUid,
    title: source?.title ?? '',
    artist: source?.artist ?? '',
    src: source?.src ?? '',
  }
}

// 这里保留 await：表单在 setup 期同步初始化，SSR 与水合才能拿到同一份初值（避免水合不匹配）。
// 提速交给 getCachedData + 空闲 / 悬停预热——命中缓存时 await 同步返回，点进来即秒开
const { data } = await useFetch<{ meta: SiteMetaShape }>('/api/admin/site', {
  key: 'admin-site',
  getCachedData: sessionCachedData,
})

const metaForm = reactive({
  title: data.value?.meta?.title ?? '',
  tagline: data.value?.meta?.tagline ?? '',
  url: data.value?.meta?.url ?? '',
  // 站名/标语与名称/签名是两份独立数据；未单独设置过时，用当前生效值预填，避免出现空输入框
  tabTitle: data.value?.meta?.tabTitle || data.value?.meta?.title || '',
  tabTagline: data.value?.meta?.tabTagline || data.value?.meta?.tagline || '',
  avatar: data.value?.meta?.avatar ?? '',
  favicon: data.value?.meta?.favicon ?? '',
  playerEnabled: data.value?.meta?.playerEnabled !== false,
  playlist: (data.value?.meta?.playlist ?? []).map((t) => makeTrack(t)),
})

const metaSaving = ref(false)
const metaMessage = ref('')
const metaFailed = ref(false)

// 未上传过时展示前台使用的默认图，保证这里始终能看到「当前头像 / 当前图标」
const DEFAULT_AVATAR = '/media/609-1686745579-2-s.jpg'
const DEFAULT_FAVICON = '/uploads/library/59-cropped-1-2.jpg'
const avatarPreview = computed(() => metaForm.avatar || DEFAULT_AVATAR)
const faviconPreview = computed(() => metaForm.favicon || DEFAULT_FAVICON)

// 头像框做成正方形且底部与「站点地址」输入框对齐：flex 无法由拉伸高度反推宽度，改为实测字段高度
const profileFieldsEl = ref<HTMLElement | null>(null)
const avatarSize = ref(0)
let fieldsObserver: ResizeObserver | null = null

function measureAvatar() {
  const el = profileFieldsEl.value
  const parent = el?.parentElement
  if (!el || !parent) return
  // 窄屏下字段改为竖排，头像不再跟随字段高度，回落到 CSS 固定尺寸
  const stacked = !getComputedStyle(parent).flexDirection.startsWith('row')
  avatarSize.value = stacked ? 0 : Math.round(el.getBoundingClientRect().height)
}

onMounted(() => {
  if (!profileFieldsEl.value) return
  fieldsObserver = new ResizeObserver(measureAvatar)
  fieldsObserver.observe(profileFieldsEl.value)
  window.addEventListener('resize', measureAvatar)
  measureAvatar()
})
onBeforeUnmount(() => {
  fieldsObserver?.disconnect()
  window.removeEventListener('resize', measureAvatar)
})

// ===== 头像 / 图标：选图 → 裁剪 → 上传，拿到地址后写进表单，点「保存」生效 =====
type CropTarget = 'avatar' | 'favicon'

const avatarPicker = ref<HTMLInputElement | null>(null)
const faviconPicker = ref<HTMLInputElement | null>(null)
const cropTarget = ref<CropTarget | null>(null)
const cropSrc = ref('')
const cropBusy = ref(false)

const cropOpen = computed(() => cropTarget.value !== null)
// 头像裁圆，标签图标裁方（图标在标签页里是方形槽位，圆形会留下透明四角）
const cropShape = computed(() => (cropTarget.value === 'favicon' ? 'square' : 'circle'))
const avatarBusy = computed(() => cropBusy.value && cropTarget.value === 'avatar')
const faviconBusy = computed(() => cropBusy.value && cropTarget.value === 'favicon')

function onPickImage(target: CropTarget, event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) {
    metaFailed.value = true
    metaMessage.value = '请选择图片文件。'
    return
  }
  releaseCropSrc()
  cropSrc.value = URL.createObjectURL(file)
  cropTarget.value = target
}

function releaseCropSrc() {
  if (cropSrc.value) {
    URL.revokeObjectURL(cropSrc.value)
    cropSrc.value = ''
  }
}

function closeCropper() {
  cropTarget.value = null
  releaseCropSrc()
}

async function onCropConfirm(blob: Blob) {
  const target = cropTarget.value
  if (!target) return
  cropBusy.value = true
  metaMessage.value = ''
  try {
    const body = new FormData()
    body.append('file', new File([blob], `${target}-${Date.now()}.png`, { type: 'image/png' }))
    const res = await $fetch<{ file: { url: string } }>('/api/admin/media', { method: 'POST', body })
    metaForm[target] = res.file.url
    metaFailed.value = false
    metaMessage.value = `${target === 'avatar' ? '头像' : '图标'}已上传，点「保存」后生效。`
  } catch (e) {
    metaFailed.value = true
    metaMessage.value = adminError(e, '上传失败')
  } finally {
    cropBusy.value = false
    closeCropper()
  }
}

async function saveMeta() {
  metaSaving.value = true
  metaMessage.value = ''
  try {
    await $fetch('/api/admin/site', { method: 'PUT', body: { meta: { ...metaForm } } })
    // 前台读 site-meta、后台读 admin-site，两个缓存槽都要刷新，避免回到本页时看到旧值
    await Promise.all([refreshNuxtData('site-meta'), refreshNuxtData('admin-site')])
    metaFailed.value = false
    metaMessage.value = '已保存。'
  } catch (e) {
    metaFailed.value = true
    metaMessage.value = adminError(e, '保存失败')
  } finally {
    metaSaving.value = false
  }
}

// ===== 悬浮播放器的歌单 =====
const trackFileEl = ref<HTMLInputElement | null>(null)
const trackPickerIndex = ref(-1)
const audioUploading = ref(false)

function addTrack() {
  metaForm.playlist.push(makeTrack())
}

function removeTrack(i: number) {
  metaForm.playlist.splice(i, 1)
}

function moveTrack(i: number, delta: number) {
  const j = i + delta
  if (j < 0 || j >= metaForm.playlist.length) return
  const [row] = metaForm.playlist.splice(i, 1)
  metaForm.playlist.splice(j, 0, row)
}

function pickAudio(i: number) {
  trackPickerIndex.value = i
  trackFileEl.value?.click()
}

// 音频上传进媒体库（不带 scope）：曲目引用的是独立资源，
// 不走文章私有目录，删文章不会把歌单里的曲子一起带走
async function uploadAudio(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  const row = metaForm.playlist[trackPickerIndex.value]
  if (!file || !row) {
    input.value = ''
    return
  }
  audioUploading.value = true
  metaMessage.value = ''
  try {
    const body = new FormData()
    body.append('file', file)
    const res = await $fetch<{ file: { url: string; name: string } }>('/api/admin/media', {
      method: 'POST',
      body,
    })
    row.src = res.file.url
    // 曲名留空时用文件名兜一下，省得还要手打
    if (!row.title) row.title = res.file.name.replace(/\.[^.]+$/, '')
    metaFailed.value = false
    metaMessage.value = '音频已上传，记得点「保存」生效。'
  } catch (e) {
    metaFailed.value = true
    metaMessage.value = adminError(e, '上传失败')
  } finally {
    audioUploading.value = false
    input.value = ''
  }
}
</script>

<template>
  <div>
    <div class="ad-head">
      <div>
        <h1 class="ad-title">站点信息</h1>
        <p class="ad-sub">名称、签名、头像与浏览器标签</p>
      </div>
    </div>

    <section class="ad-card">
      <div class="ad-card__head">
        <h2 class="ad-card__title">基本信息</h2>
        <button class="ad-btn ad-btn--primary" type="button" :disabled="metaSaving" @click="saveMeta">
          {{ metaSaving ? '保存中…' : '保存' }}
        </button>
      </div>

      <div class="ad-profile">
        <button
          class="ad-avatar"
          type="button"
          :style="avatarSize ? { width: `${avatarSize}px`, height: `${avatarSize}px` } : undefined"
          :disabled="avatarBusy"
          title="点击上传头像"
          @click="avatarPicker?.click()"
        >
          <img :src="avatarPreview" alt="站点头像" />
          <span class="ad-avatar__veil">{{ avatarBusy ? '上传中…' : '更换头像' }}</span>
        </button>
        <input ref="avatarPicker" type="file" accept="image/*" hidden @change="onPickImage('avatar', $event)" />

        <div ref="profileFieldsEl" class="ad-profile__fields">
          <label class="ad-field">
            <span class="ad-label">名称</span>
            <input v-model="metaForm.title" class="ad-input" type="text" />
          </label>
          <label class="ad-field">
            <span class="ad-label">签名</span>
            <input v-model="metaForm.tagline" class="ad-input" type="text" />
          </label>
          <label class="ad-field">
            <span class="ad-label">站点地址</span>
            <input v-model="metaForm.url" class="ad-input" type="text" />
          </label>
        </div>
      </div>

      <p class="ad-hint" style="margin: 12px 0 0">以上内容对应前台导航栏左侧的头像、名称、签名与站点地址。</p>

      <div class="ad-tabrow">
        <div class="ad-field ad-field--icon">
          <span class="ad-label">图标</span>
          <button
            class="ad-favicon"
            type="button"
            :disabled="faviconBusy"
            title="点击上传图标"
            @click="faviconPicker?.click()"
          >
            <img :src="faviconPreview" alt="站点图标" />
            <span class="ad-favicon__veil">{{ faviconBusy ? '上传中…' : '更换' }}</span>
          </button>
          <input ref="faviconPicker" type="file" accept="image/*" hidden @change="onPickImage('favicon', $event)" />
        </div>

        <label class="ad-field">
          <span class="ad-label">站名</span>
          <input v-model="metaForm.tabTitle" class="ad-input" type="text" />
        </label>

        <label class="ad-field">
          <span class="ad-label">标语</span>
          <input v-model="metaForm.tabTagline" class="ad-input" type="text" />
        </label>
      </div>

      <p class="ad-hint" style="margin: 12px 0 0">
        以上三项决定浏览器标签页的图标与文字。站名、标语与上方「名称、签名」各自独立，互不影响。
      </p>

      <p v-if="metaMessage" class="ad-msg" :class="metaFailed ? 'is-error' : 'is-ok'">{{ metaMessage }}</p>
    </section>

    <!-- 悬浮播放器：曲目全部来自媒体库，歌单为空时前台不渲染播放器 -->
    <section class="ad-card">
      <div class="ad-card__head">
        <h2 class="ad-card__title">悬浮播放器</h2>
        <button class="ad-btn ad-btn--primary" type="button" :disabled="metaSaving" @click="saveMeta">
          {{ metaSaving ? '保存中…' : '保存' }}
        </button>
      </div>

      <div class="ad-checks">
        <label class="ad-check">
          <input v-model="metaForm.playerEnabled" type="checkbox" />
          在前台显示右下角的悬浮播放器
        </label>
      </div>

      <p class="ad-hint" style="margin: 10px 0 6px">
        歌单为空时前台完全不渲染播放器，页面与未开启时一致。曲目按这里的顺序播放，音频可上传到媒体库，也可直接填站内地址或外链。
      </p>

      <div v-if="metaForm.playlist.length" class="ad-trk-list">
        <div v-for="(t, i) in metaForm.playlist" :key="t.uid" class="ad-trk">
          <div class="ad-trk__no">{{ i + 1 }}</div>
          <div class="ad-trk__content">
            <div class="ad-trk__pair">
              <label class="ad-field">
                <span class="ad-label">曲名</span>
                <input v-model="t.title" class="ad-input" type="text" placeholder="Lullaby" />
              </label>
              <label class="ad-field">
                <span class="ad-label">副标题</span>
                <input v-model="t.artist" class="ad-input" type="text" placeholder="光影练习 · 附曲" />
              </label>
            </div>

            <label class="ad-field">
              <span class="ad-label">音频地址</span>
              <div class="ad-trk__src">
                <input
                  v-model="t.src"
                  class="ad-input"
                  type="text"
                  placeholder="/uploads/... 或 https://..."
                />
                <button
                  class="ad-btn ad-btn--sm"
                  type="button"
                  :disabled="audioUploading"
                  @click="pickAudio(i)"
                >
                  上传音频
                </button>
              </div>
            </label>

            <div class="ad-trk__ops">
              <button class="ad-btn ad-btn--sm" type="button" :disabled="i === 0" @click="moveTrack(i, -1)">
                上移
              </button>
              <button
                class="ad-btn ad-btn--sm"
                type="button"
                :disabled="i === metaForm.playlist.length - 1"
                @click="moveTrack(i, 1)"
              >
                下移
              </button>
              <button class="ad-btn ad-btn--sm" type="button" @click="removeTrack(i)">删除</button>
              <span v-if="audioUploading && trackPickerIndex === i" class="ad-hint" style="margin: 0">上传中…</span>
            </div>
          </div>
        </div>
      </div>
      <p v-else class="ad-hint" style="margin: 0 0 12px">还没有曲目。</p>

      <button class="ad-btn ad-btn--sm" type="button" @click="addTrack">+ 添加一首</button>
      <input ref="trackFileEl" type="file" accept="audio/*" hidden @change="uploadAudio" />

      <p v-if="metaMessage" class="ad-msg" :class="metaFailed ? 'is-error' : 'is-ok'" style="margin: 12px 0 0">
        {{ metaMessage }}
      </p>
    </section>

    <ImageCropper
      v-if="cropOpen"
      :src="cropSrc"
      :shape="cropShape"
      :busy="cropBusy"
      @confirm="onCropConfirm"
      @cancel="closeCropper"
    />
  </div>
</template>

<style scoped>
/* 歌单一行：左侧序号，右侧字段与操作纵向排开 */
.ad-trk-list {
  margin: 8px 0 14px;
}
.ad-trk {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr);
  gap: 12px;
  padding: 16px 0;
  border-top: 1px solid var(--gg-border);
}
.ad-trk:first-child {
  border-top: 0;
  padding-top: 4px;
}
.ad-trk__no {
  padding-top: 24px;
  font-size: 0.8rem;
  color: var(--gg-muted);
  font-variant-numeric: tabular-nums;
}
.ad-trk__content {
  display: grid;
  gap: 12px;
  min-width: 0;
}
.ad-trk__pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}
/* 地址输入吃掉剩余宽度，按钮不换行 */
.ad-trk__src {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ad-trk__src .ad-input {
  flex: 1;
  min-width: 0;
}
.ad-trk__src .ad-btn {
  flex: none;
}
.ad-trk__ops {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
@media (max-width: 720px) {
  .ad-trk {
    grid-template-columns: minmax(0, 1fr);
  }
  .ad-trk__no {
    padding-top: 0;
  }
  .ad-trk__pair {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
