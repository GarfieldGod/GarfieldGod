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
