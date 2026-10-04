<script setup lang="ts">
// 孤儿页面：/search（由原 garfieldgod.github.io 的 MainPage.html 移植）。
// 保持原页的布局结构与「点头像 → 页眉/封面收起、头像浏览器撑满全屏」的动画编排；
// 现代化只体现在：用 Vue 状态驱动替代 jQuery 直接改 class、用 CSS transition-delay 编排时序、
// 缓动曲线换成标准贝塞尔，并补上键盘操作与 prefers-reduced-motion。
//
// 页面数据（封面 / 头像 / 个人信息 / 右侧快捷入口）存在 site_meta 的 search 键下，
// 管理员可通过右下角的隐蔽按钮进入编辑模式就地修改。

definePageMeta({ layout: false })
useHead({
  title: 'GarfieldGod — 搜索',
  // 原页 body 为纯黑，覆盖主站默认的浅灰底
  bodyAttrs: { style: 'background: #000' },
})

interface SearchLink {
  label: string
  href: string
  icon: string
}
interface SearchConfig {
  cover: string
  avatar: string
  name: string
  tagline: string
  link: string
  links: SearchLink[]
  viewerTitle: string
  avatars: string[]
}

// 接口取不到时的兜底，保证孤儿页单独打开也成形（与 server/utils/searchPage.ts 的默认值一致）
const FALLBACK: SearchConfig = {
  cover: '/legacy/hello-world.jpg',
  avatar: '/legacy/psc.jpg',
  name: 'GarfieldGod',
  tagline: "I'm God.",
  link: 'https://garfieldgod.cn',
  viewerTitle: 'The Cutest Person In The World',
  avatars: [
    '/legacy/avatar-1.jpg',
    '/legacy/avatar-2.jpg',
    '/legacy/avatar-3.jpg',
    '/legacy/avatar-4.jpg',
    '/legacy/avatar-5.jpg',
  ],
  links: [
    { label: '哔哩哔哩', href: 'https://www.bilibili.com', icon: '/legacy/bilibili.png' },
    { label: '百度翻译', href: 'https://fanyi.baidu.com/', icon: '/legacy/links/baidu-translate.jpg' },
    { label: '百度', href: 'https://www.baidu.com/', icon: '/legacy/links/baidu.jpg' },
    { label: '开发者客栈', href: 'https://www.developers.pub', icon: '/legacy/links/developers-pub.png' },
    { label: '牛客网', href: 'https://www.nowcoder.com/', icon: '/legacy/links/nowcoder.png' },
    { label: '力扣', href: 'https://leetcode.cn/', icon: '/legacy/links/leetcode.png' },
    { label: '海投网', href: 'https://xyzp.haitou.cc/trade-113', icon: '/legacy/links/haitou.png' },
    { label: '社区', href: 'https://garfieldgod.cn/index.php/forum/', icon: '/legacy/links/community.png' },
  ],
}

const { data } = await useFetch<SearchConfig>('/api/search-config', { key: 'search-config' })

function clone(src: SearchConfig): SearchConfig {
  return { ...src, links: src.links.map((l) => ({ ...l })), avatars: [...src.avatars] }
}

// 服务端已做过一次归一化，这里再兜一层，避免接口异常时渲染出 undefined
function normalize(raw: Partial<SearchConfig> | null | undefined): SearchConfig {
  const base = { ...FALLBACK, ...(raw ?? {}) }
  const avatars = Array.isArray(base.avatars)
    ? base.avatars.filter((s) => typeof s === 'string' && s.trim() !== '')
    : []
  return {
    cover: base.cover || FALLBACK.cover,
    avatar: base.avatar || FALLBACK.avatar,
    name: typeof base.name === 'string' ? base.name : FALLBACK.name,
    tagline: typeof base.tagline === 'string' ? base.tagline : FALLBACK.tagline,
    link: typeof base.link === 'string' ? base.link : FALLBACK.link,
    viewerTitle: typeof base.viewerTitle === 'string' && base.viewerTitle ? base.viewerTitle : FALLBACK.viewerTitle,
    avatars: avatars.length ? avatars : [...FALLBACK.avatars],
    links: Array.isArray(base.links)
      ? base.links.map((l) => ({ label: l?.label ?? '', href: l?.href ?? '', icon: l?.icon ?? '' }))
      : clone(FALLBACK).links,
  }
}

// config 是已保存的值，draft 是编辑期间的工作副本；取消即丢弃草稿
const config = ref<SearchConfig>(normalize(data.value))
const draft = reactive<SearchConfig>(normalize(data.value))

// 查看器的图片列表：跟随 draft，保存后即为配置值
const viewerImages = computed(() => draft.avatars)

const keyword = ref('')
const viewing = ref(false)
const active = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

function stopSlideshow() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
function next() {
  if (viewerImages.value.length) active.value = (active.value + 1) % viewerImages.value.length
}
function prev() {
  if (viewerImages.value.length)
    active.value = (active.value - 1 + viewerImages.value.length) % viewerImages.value.length
}
// 原站每 5 秒换一张，手动切换后重新计时
function startSlideshow() {
  stopSlideshow()
  timer = setInterval(next, 5000)
}

// 第一步要求「头像 + 信息」整体滑到视口水平中央（不是只让头像居中）。
// 页眉内部是几层按百分比嵌套的旧版宽度，靠 CSS 反推中心太脆，
// 这里直接量出静止态整体的左边界与宽度，再算它到视口中心的位移，交给 transform 过渡。
const unitEl = ref<HTMLElement | null>(null)
const shift = ref(0)

function measureUnitShift() {
  const el = unitEl.value
  if (!el || !import.meta.client) return
  // rect 会带上「已经施加的位移」（整体已滑到中间时），先减掉还原静止态左边界，
  // 否则窗口 resize 时重新测量会把位移算两遍。
  const applied = viewing.value ? shift.value : 0
  const rect = el.getBoundingClientRect()
  const restLeft = rect.left - applied
  shift.value = Math.round(window.innerWidth / 2 - (restLeft + rect.width / 2))
}

function onResize() {
  if (viewing.value) measureUnitShift()
}

// 原站打开时随机挑一张作为起始
function openViewer() {
  if (!viewerImages.value.length) return
  active.value = Math.floor(Math.random() * viewerImages.value.length)
  measureUnitShift()
  viewing.value = true
  startSlideshow()
}
function closeViewer() {
  viewing.value = false
  stopSlideshow()
}

function step(dir: -1 | 1) {
  if (dir === 1) next()
  else prev()
  startSlideshow()
}

// ===== 编辑权限：只有管理员能看到入口，写接口本身也由 admin-guard 兜底 =====
// 刻意只在客户端探测：这个页面会进静态生成，若在 SSR 阶段取会话状态，
// 编辑入口可能被烤进静态 HTML 发给所有访客。
const canEdit = ref(false)

const editMode = ref(false)
const saving = ref(false)
const editMsg = ref('')
const editFailed = ref(false)

const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null
function showToast(text: string) {
  toast.value = text
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.value = ''
  }, 2600)
}

function enterEdit() {
  Object.assign(draft, clone(config.value))
  editMsg.value = ''
  editFailed.value = false
  editMode.value = true
}

function cancelEdit() {
  Object.assign(draft, clone(config.value))
  closeLinkEditor()
  closeViewerEditor()
  closeCropper()
  editMode.value = false
}

async function saveEdit() {
  saving.value = true
  editMsg.value = ''
  try {
    const res = await $fetch<{ config: SearchConfig }>('/api/admin/search-config', {
      method: 'PUT',
      body: { ...draft, links: draft.links.map((l) => ({ ...l })) },
    })
    const next = normalize(res.config)
    config.value = next
    Object.assign(draft, clone(next))
    editFailed.value = false
    editMode.value = false
    showToast('已保存。')
  } catch (e) {
    editFailed.value = true
    editMsg.value = adminError(e, '保存失败')
  } finally {
    saving.value = false
  }
}

// ===== 右侧入口的编辑 / 新增弹窗 =====
const linkEditor = reactive({ open: false, index: -1, label: '', href: '', icon: '', error: '' })

function openLinkEditor(index: number) {
  const src = index >= 0 ? draft.links[index] : null
  linkEditor.index = index
  linkEditor.label = src?.label ?? ''
  linkEditor.href = src?.href ?? ''
  linkEditor.icon = src?.icon ?? ''
  linkEditor.error = ''
  linkEditor.open = true
}

function closeLinkEditor() {
  linkEditor.open = false
}

function isSafeUrl(value: string) {
  return /^https?:\/\//i.test(value) || value.startsWith('/')
}

function confirmLink() {
  const icon = linkEditor.icon.trim()
  const href = linkEditor.href.trim()
  if (!icon) {
    linkEditor.error = '请填写图标地址。'
    return
  }
  if (!isSafeUrl(icon)) {
    linkEditor.error = '图标需以 http:// 或 https:// 开头，或以 / 开头的站内路径。'
    return
  }
  if (!href) {
    linkEditor.error = '请填写链接地址。'
    return
  }
  if (!isSafeUrl(href)) {
    linkEditor.error = '链接需以 http:// 或 https:// 开头，或以 / 开头的站内路径。'
    return
  }

  const item: SearchLink = {
    // 名称留空时用去掉协议与末尾斜杠的链接兜底，保证 alt / title 不为空
    label: linkEditor.label.trim() || href.replace(/^https?:\/\//i, '').replace(/\/+$/, ''),
    href,
    icon,
  }
  if (linkEditor.index >= 0) draft.links[linkEditor.index] = item
  else draft.links.push(item)
  linkEditor.open = false
}

function removeLink() {
  if (linkEditor.index < 0) return
  draft.links.splice(linkEditor.index, 1)
  linkEditor.open = false
}

// ===== 查看器设置弹窗：改标题 + 增删图片列表 =====
const viewerEditor = reactive({ open: false, busy: false, error: '' })
const viewerInput = ref<HTMLInputElement | null>(null)

function openViewerEditor() {
  viewerEditor.error = ''
  viewerEditor.open = true
}
function closeViewerEditor() {
  viewerEditor.open = false
}
function pickViewerImages() {
  if (viewerEditor.busy) return
  viewerInput.value?.click()
}
async function onViewerPick(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? []).filter((f) => f.type.startsWith('image/'))
  input.value = ''
  if (!files.length) return
  viewerEditor.busy = true
  viewerEditor.error = ''
  try {
    for (const file of files) {
      draft.avatars.push(await uploadMedia(file))
    }
    showToast('图片已上传，点「保存」后生效。')
  } catch (e) {
    viewerEditor.error = adminError(e, '上传失败')
  } finally {
    viewerEditor.busy = false
  }
}
function removeViewerImage(index: number) {
  // 至少保留一张，否则查看器打开后没有可展示的图片
  if (draft.avatars.length <= 1) {
    viewerEditor.error = '至少保留一张图片。'
    return
  }
  viewerEditor.error = ''
  draft.avatars.splice(index, 1)
}

// ===== 封面 / 头像上传：复用后台的媒体上传接口 =====
const mediaInput = ref<HTMLInputElement | null>(null)
const coverBusy = ref(false)
const cropOpen = ref(false)
const cropSrc = ref('')
const cropBusy = ref(false)
// 'cover' 直接上传；'avatar' 先裁成正方形再上传
let pending: 'cover' | 'avatar' = 'cover'

const avatarBusy = computed(() => cropBusy.value)

function pickCover() {
  if (coverBusy.value) return
  pending = 'cover'
  mediaInput.value?.click()
}
function pickAvatar() {
  if (cropBusy.value) return
  pending = 'avatar'
  mediaInput.value?.click()
}

function onMediaPick(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) {
    showToast('请选择图片文件。')
    return
  }
  if (pending === 'avatar') {
    releaseCropSrc()
    cropSrc.value = URL.createObjectURL(file)
    cropOpen.value = true
    return
  }
  uploadCover(file)
}

async function uploadMedia(file: File): Promise<string> {
  const body = new FormData()
  body.append('file', file)
  const res = await $fetch<{ file: { url: string } }>('/api/admin/media', { method: 'POST', body })
  return res.file.url
}

async function uploadCover(file: File) {
  coverBusy.value = true
  try {
    draft.cover = await uploadMedia(file)
    showToast('封面已上传，点「保存」后生效。')
  } catch (e) {
    showToast(adminError(e, '上传失败'))
  } finally {
    coverBusy.value = false
  }
}

function releaseCropSrc() {
  if (cropSrc.value) {
    URL.revokeObjectURL(cropSrc.value)
    cropSrc.value = ''
  }
}

function closeCropper() {
  cropOpen.value = false
  releaseCropSrc()
}

async function onCropConfirm(blob: Blob) {
  cropBusy.value = true
  try {
    const file = new File([blob], `search-avatar-${Date.now()}.png`, { type: 'image/png' })
    draft.avatar = await uploadMedia(file)
    showToast('头像已上传，点「保存」后生效。')
  } catch (e) {
    showToast(adminError(e, '上传失败'))
  } finally {
    cropBusy.value = false
    closeCropper()
  }
}

// ===== 键盘：Esc 优先关弹窗，其次退查看器；查看器里左右键换图 =====
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (viewerEditor.open) closeViewerEditor()
    else if (linkEditor.open) closeLinkEditor()
    else if (viewing.value) closeViewer()
    return
  }
  if (!viewing.value) return
  if (e.key === 'ArrowRight') step(1)
  else if (e.key === 'ArrowLeft') step(-1)
}

onMounted(async () => {
  document.addEventListener('keydown', onKey)
  window.addEventListener('resize', onResize)
  try {
    const res = await $fetch<{ authenticated: boolean }>('/api/admin/session')
    canEdit.value = res.authenticated === true
  } catch {
    canEdit.value = false
  }
})
onBeforeUnmount(() => {
  stopSlideshow()
  if (toastTimer) clearTimeout(toastTimer)
  if (import.meta.client) {
    document.removeEventListener('keydown', onKey)
    window.removeEventListener('resize', onResize)
  }
})

// 原站行为：回车 / 点击圆钮都跳百度搜索
function submitSearch() {
  window.location.href = `https://www.baidu.com/s?wd=${encodeURIComponent(keyword.value.trim())}`
}

// 个人信息里显示的站点名（去掉协议与末尾斜杠），与原站「garfieldgod.cn」的写法一致
const linkLabel = computed(() =>
  draft.link.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, ''),
)

// 右侧浮窗高度随入口数量伸缩：每个圆钮 50px + 5px 间距，上下各留 5px。
// 圆钮直径 50 与浮窗两端半径（60px 宽 → 30px）同心，5px 边距刚好让图标嵌进圆角，不再留空。
// 编辑模式末尾会多一个「＋」按钮，一并计入。
const menuHeight = computed(() => {
  const count = draft.links.length + (editMode.value ? 1 : 0)
  return `${count * 55 + 5}px`
})
</script>

<template>
  <div class="mp" :style="{ '--mp-shift': `${shift}px` }">
    <!-- 头像浏览器（原站点头像后展开的全屏层）：只负责黑色背板与纵向展开的图片舞台 -->
    <div
      class="mp-viewer"
      :class="{ 'is-open': viewing }"
      role="dialog"
      aria-modal="true"
      aria-label="头像查看器"
    >
      <div class="mp-viewer__stage">
        <img
          v-for="(src, i) in viewerImages"
          :key="`${src}-${i}`"
          :src="src"
          :class="{ 'is-active': i === active }"
          alt=""
        >
        <button class="mp-viewer__nav mp-viewer__nav--prev" type="button" aria-label="上一张" @click="step(-1)">❮</button>
        <button class="mp-viewer__nav mp-viewer__nav--next" type="button" aria-label="下一张" @click="step(1)">❯</button>
      </div>
    </div>

    <!-- 标题与返回按钮固定在各自的最终位置，不随舞台纵向拉伸而上下移动：
         标题从上往下纵向展开，返回按钮从中央向两侧横向展开 -->
    <p class="mp-viewer__title" :class="{ 'is-open': viewing }">❮---------------{{ draft.viewerTitle }}---------------❯</p>
    <button class="mp-viewer__esc" :class="{ 'is-open': viewing }" type="button" @click="closeViewer">返回</button>

    <!-- 封面：编辑模式下点击更换 -->
    <div
      class="mp-cover"
      :class="{ 'is-none': viewing, 'is-editing': editMode }"
      @click="editMode && pickCover()"
    >
      <img :src="draft.cover" alt="">
    </div>
    <div v-if="editMode" class="mp-coverhint">
      {{ coverBusy ? '上传中…' : '点击封面可更换图片' }}
    </div>

    <!-- 页眉：点头像后封面收起，页眉被顶到顶部（第二步「导航栏上台」），随后被查看器覆盖 -->
    <div class="mp-header">
      <div class="mp-navblock">
        <div class="mp-navblock-a">
          <div ref="unitEl" class="mp-navblock-b" :class="{ 'is-viewing': viewing }">
            <span class="mp-avatar-slot">
              <button
                class="mp-avatar"
                type="button"
                :aria-label="editMode ? '更换头像' : '查看头像'"
                @click="editMode ? pickAvatar() : openViewer()"
              >
                <img :src="draft.avatar" alt="GarfieldGod 头像">
                <span v-if="editMode" class="mp-avatar__veil">{{ avatarBusy ? '上传中…' : '更换头像' }}</span>
              </button>
            </span>

            <div class="mp-intro">
              <template v-if="editMode">
                <input v-model="draft.name" class="mp-intro__input mp-intro__input--name" type="text" maxlength="60" placeholder="名称">
                <input v-model="draft.tagline" class="mp-intro__input" type="text" maxlength="120" placeholder="签名">
                <input v-model="draft.link" class="mp-intro__input" type="text" placeholder="站点链接 https://…">
              </template>
              <template v-else>
                <h1 class="mp-intro__name">{{ draft.name }}</h1>
                <p class="mp-intro__line">
                  {{ draft.tagline }}<br>
                  <a v-if="draft.link" class="mp-intro__link" :href="draft.link">{{ linkLabel }}</a>
                </p>
              </template>
            </div>
          </div>

          <div class="mp-searchout">
            <div class="mp-searchclip" :class="{ 'is-collapsed': viewing }">
              <form class="mp-search" @submit.prevent="submitSearch">
                <input
                  v-model="keyword"
                  class="mp-search__input"
                  type="text"
                  autocomplete="off"
                  aria-label="搜索关键词"
                >
                <button class="mp-search__btn" type="submit" aria-label="搜索">◯</button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 侧边栏：高度随入口数量伸缩；编辑模式下每个入口变成编辑按钮，末尾插入「添加」 -->
    <div
      class="mp-menu"
      :class="{ 'is-closed': viewing, 'is-editing': editMode }"
      :style="{ height: menuHeight }"
    >
      <template v-if="editMode">
        <button
          v-for="(l, i) in draft.links"
          :key="`edit-${i}`"
          class="mp-icon"
          type="button"
          :title="l.label || l.href"
          :aria-label="`编辑入口：${l.label || l.href}`"
          @click="openLinkEditor(i)"
        >
          <img :src="l.icon" :alt="l.label">
        </button>
        <button class="mp-icon mp-icon--add" type="button" aria-label="添加入口" title="添加入口" @click="openLinkEditor(-1)">＋</button>
      </template>
      <template v-else>
        <a
          v-for="(l, i) in draft.links"
          :key="`link-${i}`"
          class="mp-icon"
          :href="l.href"
          target="_blank"
          rel="noopener"
          :aria-label="l.label"
          :title="l.label"
        >
          <img :src="l.icon" :alt="l.label">
        </a>
      </template>
    </div>

    <!-- 隐蔽的编辑入口：仅管理员可见，静置时几乎透明 -->
    <button
      v-if="canEdit && !editMode"
      class="mp-editbtn"
      type="button"
      title="编辑页面"
      aria-label="编辑页面"
      @click="enterEdit"
    >✎</button>

    <div v-if="canEdit && editMode" class="mp-editbar">
      <!-- 「更改」入口：贴在下方黑条（工具条）的右上角 -->
      <button
        class="mp-changebtn"
        type="button"
        title="更改标题与图片"
        aria-label="更改标题与图片"
        @click="openViewerEditor"
      >更改</button>
      <span class="mp-editbar__msg" :class="{ 'is-error': editFailed }">{{ editMsg || '编辑模式' }}</span>
      <button class="mp-editbar__btn" type="button" :disabled="saving" @click="cancelEdit">取消</button>
      <button class="mp-editbar__btn mp-editbar__btn--primary" type="button" :disabled="saving" @click="saveEdit">
        {{ saving ? '保存中…' : '保存' }}
      </button>
    </div>

    <!-- 入口编辑 / 新增弹窗 -->
    <div v-if="linkEditor.open" class="mp-modal" @click.self="closeLinkEditor">
      <div class="mp-modal__panel" role="dialog" aria-modal="true" aria-label="编辑入口">
        <h2 class="mp-modal__title">{{ linkEditor.index >= 0 ? '编辑入口' : '添加入口' }}</h2>

        <label class="mp-field">
          <span class="mp-field__label">名称</span>
          <input v-model="linkEditor.label" class="mp-field__input" type="text" maxlength="40" placeholder="例如：哔哩哔哩">
        </label>

        <label class="mp-field">
          <span class="mp-field__label">图标</span>
          <span class="mp-field__row">
            <input v-model="linkEditor.icon" class="mp-field__input" type="text" placeholder="/uploads/… 或 https://…">
            <span class="mp-field__preview">
              <img v-if="linkEditor.icon" :src="linkEditor.icon" alt="">
            </span>
          </span>
        </label>

        <label class="mp-field">
          <span class="mp-field__label">链接</span>
          <input v-model="linkEditor.href" class="mp-field__input" type="text" placeholder="https://…">
        </label>

        <p v-if="linkEditor.error" class="mp-modal__error">{{ linkEditor.error }}</p>

        <div class="mp-modal__actions">
          <button
            v-if="linkEditor.index >= 0"
            class="mp-mbtn mp-mbtn--danger"
            type="button"
            @click="removeLink"
          >删除</button>
          <span class="mp-modal__spacer" />
          <button class="mp-mbtn" type="button" @click="closeLinkEditor">取消</button>
          <button class="mp-mbtn mp-mbtn--primary" type="button" @click="confirmLink">确认</button>
        </div>
      </div>
    </div>

    <!-- 查看器设置弹窗：改标题 + 增删图片 -->
    <div v-if="viewerEditor.open" class="mp-modal" @click.self="closeViewerEditor">
      <div class="mp-modal__panel mp-modal__panel--wide" role="dialog" aria-modal="true" aria-label="更改标题与图片">
        <h2 class="mp-modal__title">更改</h2>

        <label class="mp-field">
          <span class="mp-field__label">标题</span>
          <input
            v-model="draft.viewerTitle"
            class="mp-field__input"
            type="text"
            maxlength="120"
            placeholder="查看器顶部标题"
          >
        </label>

        <div class="mp-field">
          <span class="mp-field__label">图片列表（{{ draft.avatars.length }} 张）</span>
          <div class="mp-thumbs">
            <div v-for="(src, i) in draft.avatars" :key="`${src}-${i}`" class="mp-thumb">
              <img :src="src" alt="">
              <button
                class="mp-thumb__del"
                type="button"
                aria-label="删除这张图片"
                title="删除"
                @click="removeViewerImage(i)"
              >✕</button>
            </div>
            <button
              class="mp-thumb mp-thumb--add"
              type="button"
              :disabled="viewerEditor.busy"
              aria-label="上传图片"
              title="上传图片"
              @click="pickViewerImages"
            >{{ viewerEditor.busy ? '…' : '＋' }}</button>
          </div>
        </div>

        <p v-if="viewerEditor.error" class="mp-modal__error">{{ viewerEditor.error }}</p>

        <div class="mp-modal__actions">
          <span class="mp-modal__spacer" />
          <button class="mp-mbtn mp-mbtn--primary" type="button" @click="closeViewerEditor">完成</button>
        </div>
      </div>
    </div>

    <div v-if="toast" class="mp-toast" role="status">{{ toast }}</div>

    <input ref="mediaInput" type="file" accept="image/*" hidden @change="onMediaPick">
    <input ref="viewerInput" type="file" accept="image/*" multiple hidden @change="onViewerPick">

    <ImageCropper
      v-if="cropOpen"
      :src="cropSrc"
      shape="circle"
      :busy="cropBusy"
      @confirm="onCropConfirm"
      @cancel="closeCropper"
    />
  </div>
</template>

<style scoped>
/* 布局尺寸沿用原 MainPage.css 的数值，只把定位/动画写法现代化。
   点头像打开分四步（关闭即逆序）：
     第一步 0s    —— 搜索框向中间收起、右侧浮窗收起、「头像 + 信息」整体滑到视口水平中央
     第二步 0.5s  —— 封面收起，页眉被顶到顶部（导航栏上台）
     第三步 1s    —— 整体到顶后「从下往上」收缩（很快，0.25s）
     第四步 1.25s —— 顶部标题与右下角返回按钮横向展开，同时查看器纵向展开 */
.mp {
  --mp-header-h: 220px;
  --mp-vh: 100vh;
  /* 封面吃掉页眉之外的全部视口高度：整页刚好一屏，不出现纵向滚动条 */
  --mp-cover-h: calc(var(--mp-vh) - var(--mp-header-h));
  --mp-avatar: 150px;
  --mp-ease: cubic-bezier(0.4, 0, 0.2, 1);
  --mp-step: 0.5s;
  /* 搜索框 / 右侧浮窗的收展时长单独拎出来，方便逐项微调 */
  --mp-search: 0.75s;
  --mp-menu: 0.75s;
  /* 「头像 + 信息」整体水平位移（滑到中间 / 落回原位）的时长 */
  --mp-slide: 0.75s;
  /* 整体「从下往上」收缩很快，单独一个时长 */
  --mp-shrink: 0.25s;
  /* 打开方向四步的延迟 */
  --mp-d1: 0s;
  --mp-d2: 0.5s;
  --mp-d3: 1s;
  --mp-d4: 1.25s;
  /* 关闭方向按逆序回退，延迟另列一组 */
  --mp-c1: 0s;
  --mp-c2: 0.5s;
  --mp-c3: 0.75s;
  --mp-c4: 1.25s;
  position: relative;
  height: var(--mp-vh);
  overflow: hidden;
  background: #000;
}
@supports (height: 100dvh) {
  .mp { --mp-vh: 100dvh; }
}
.mp h1,
.mp p { margin: 0; }

/* ===== 封面 ===== */
/* 原站 .blockcover 是 static（那句 z-index:9 不生效），所以浮层（右侧栏）才会盖在封面上。
   这里同样不能给它 position/z-index，否则会把侧栏压到封面底下。 */
.mp-cover {
  width: 100%;
  height: var(--mp-cover-h);
  overflow: hidden;
  background: #000;
  /* 关闭：等整体从上往下展开（0.75s）后再落回封面 */
  transition: height var(--mp-step) var(--mp-ease) var(--mp-c3);
}
.mp-cover.is-none {
  height: 0;
  /* 打开：等第一步的滑移做完（0.5s）再收起封面 */
  transition: height var(--mp-step) var(--mp-ease) var(--mp-d2);
}
.mp-cover.is-editing {
  cursor: pointer;
  outline: 2px dashed rgba(169, 255, 249, 0.45);
  outline-offset: -8px;
}
.mp-cover img {
  display: block;
  width: 100%;
  margin-top: -10%;
  /* 与封面高度同步，避免图片先于封面移动 */
  transition: margin-top var(--mp-step) var(--mp-ease) var(--mp-c3);
}
.mp-cover.is-none img {
  margin-top: -30%;
  transition: margin-top var(--mp-step) var(--mp-ease) var(--mp-d2);
}

/* 封面的「点击更换」提示：固定定位，不依赖封面的定位上下文 */
.mp-coverhint {
  position: fixed;
  top: 16px;
  left: 50%;
  z-index: 5;
  padding: 6px 16px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  color: #a9fff9;
  font-size: 13px;
  transform: translateX(-50%);
  pointer-events: none;
}

/* ===== 页眉 ===== */
/* 页眉本身不做收起：封面高度归零后它自然被顶到视口顶部，这就是「导航栏上台」 */
.mp-header {
  position: relative;
  height: var(--mp-header-h);
  background: #000;
}
.mp-navblock {
  position: absolute;
  inset: 0;
  width: 70%;
  min-width: 1200px;
  margin: auto;
}
.mp-navblock-a {
  position: absolute;
  inset: 0;
  width: 70%;
  min-width: 1200px;
  height: calc(var(--mp-avatar) + 4px);
  margin: auto;
}
/* 头像 + 信息区作为一个整体：
   第一步 —— 整体水平滑到视口中央（transform，0s 起）；
   第三步 —— 整体「从下往上收缩」（clip-path 把可视区从底部一路收上去，1s 起，0.25s 收完）。
   用 clip-path 而不是高度/scale：形状不变形、不占布局、也不影响头像 hover 放大。 */
.mp-navblock-b {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: flex-start;
  width: 50%;
  min-width: 550px;
  margin-left: -20%;
  /* 静止态把裁剪框向外扩 32px：头像 hover 会放大并上移，上下各溢出约 25px，
     若这里写 inset(0 0 0 0) 会把放大的头像切掉、露出页眉黑底（看起来像被黑色挡住）。
     外扩后静止态不裁任何内容，收缩动画依旧从「底部 0 → 100%」完成。 */
  clip-path: inset(-32px -32px -32px -32px);
  /* 关闭：等查看器收完（0.5s）先从上往下展开（0.25s），最后（1.25s）整体落回原位；
     水平位移时长由 --mp-slide 单独控制 */
  transition: clip-path var(--mp-shrink) var(--mp-ease) var(--mp-c2),
    transform var(--mp-slide) var(--mp-ease) var(--mp-c4);
}
.mp-navblock-b.is-viewing {
  /* 抬到查看器背板（10）之上，否则整个收缩过程会被黑色查看器盖住，等于没做 */
  z-index: 11;
  pointer-events: none;
  clip-path: inset(0 0 100% 0);
  transform: translateX(var(--mp-shift, 0px));
  /* 打开：第一步（0s）整体滑到中间，时长由 --mp-slide 单独控制；到顶后第三步（1s）从下往上快速收缩 */
  transition: clip-path var(--mp-shrink) var(--mp-ease) var(--mp-d3),
    transform var(--mp-slide) var(--mp-ease) var(--mp-d1);
}

/* 头像外层：只负责布局占位，位移与收缩都交给外层整体处理 */
.mp-avatar-slot {
  flex: none;
  margin-left: 100px;
}

/* 头像：悬浮放大沿用原站 150 → 200 / 上移 25px */
.mp-avatar {
  position: relative;
  display: block;
  width: var(--mp-avatar);
  height: var(--mp-avatar);
  padding: 0;
  border: 2px solid #fff;
  border-radius: 50%;
  overflow: hidden;
  background: #fff;
  cursor: pointer;
  transition: width 0.25s var(--mp-ease), height 0.25s var(--mp-ease),
    margin-top 0.25s var(--mp-ease);
}
.mp-avatar:hover {
  width: calc(var(--mp-avatar) + 50px);
  height: calc(var(--mp-avatar) + 50px);
  margin-top: -25px;
}
.mp-avatar img { display: block; width: 100%; height: 100%; object-fit: cover; }
.mp-avatar__veil {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 14px;
  transition: background-color 0.2s var(--mp-ease);
}
.mp-avatar:hover .mp-avatar__veil { background: rgba(0, 0, 0, 0.62); }

/* 信息区：原站 width 是「内容宽」，全局 box-sizing: border-box 会把这 250px
   连 35px 内边距一起吃进去，导致 "GarfieldGod"(约 240px) 被截断，这里改回 content-box。
   自身不做收缩动画 —— 它与头像同属一个整体，由 .mp-navblock-b 统一「从下往上收缩」。 */
.mp-intro {
  box-sizing: content-box;
  width: 250px;
  padding: 25px 0 0 35px;
  overflow: hidden;
  white-space: nowrap;
}
.mp-intro__name {
  overflow: hidden;
  color: #fff;
  font-family: 'Times New Roman', Times, serif;
  font-size: 44px;
  font-weight: 700;
  line-height: 1.3;
  text-overflow: ellipsis;
}
.mp-intro__line {
  overflow: hidden;
  color: #fff;
  text-overflow: ellipsis;
}
.mp-intro__link { color: #fff; font-style: italic; }

.mp-intro__input {
  display: block;
  width: 100%;
  height: 32px;
  margin-top: 8px;
  padding: 0 10px;
  border: 1px solid rgba(255, 255, 255, 0.32);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  font-family: var(--gg-font);
  font-size: 15px;
  outline: none;
  transition: border-color 0.2s, background-color 0.2s;
}
.mp-intro__input::placeholder { color: rgba(255, 255, 255, 0.42); }
.mp-intro__input:focus { border-color: #a9fff9; background: rgba(255, 255, 255, 0.16); }
.mp-intro__input--name {
  height: 44px;
  font-family: 'Times New Roman', Times, serif;
  font-size: 24px;
  font-weight: 700;
}

/* ===== 搜索框 ===== */
/* 锚点：left:70% / top:25% 即搜索框的中心线，宽度归零时左右两边同时向中间退 */
.mp-searchout {
  position: absolute;
  top: 25%;
  left: 70%;
  width: 0;
  height: 0;
}
/* 以锚点为中心（translateX(-50%)）摆一条 900 宽的搜索框。
   收起用 clip-path 的左右内缩来做：inset(0 50% 0 50%) 把可视区从左右两边同时挤到
   中心的一条零宽缝，展开时再回到 inset(0 0 0 0)。
   用 clip-path 而不是 width：布局盒始终 900 宽，不触发重排、也不会在宽度趋近 0 时
   残留一条描边细线（那正是「收起后没消失干净 / 展开时先冒出一小块」的根因）。 */
.mp-searchclip {
  position: absolute;
  left: 0;
  top: 0;
  width: 900px;
  height: 62px;
  transform: translateX(-50%);
  clip-path: inset(0 0 0 0);
  /* 关闭：等整体落回原位（1.25s）再向两边展开；时长由 --mp-search 单独控制 */
  transition: clip-path var(--mp-search) var(--mp-ease) var(--mp-c4);
}
.mp-searchclip.is-collapsed {
  clip-path: inset(0 50% 0 50%);
  /* 第一步：立刻收起；时长由 --mp-search 单独控制 */
  transition: clip-path var(--mp-search) var(--mp-ease) var(--mp-d1);
}
/* 搜索框本体：固定 900 宽，纵向居中交给 align-items: center */
.mp-search {
  display: flex;
  align-items: center;
  width: 900px;
  height: 62px;
  padding: 0 5px;
  background: #1b272e;
  box-shadow: inset 0 0 0 1px #e0e0e0;
  border-radius: 5px;
}
.mp-search__input {
  flex: 1;
  min-width: 0;
  height: 50px;
  padding-left: 17px;
  border: 1px solid #fff;
  border-radius: 5px;
  font-size: 24px;
  color: #000;
  outline: none;
}
.mp-search__btn {
  flex: none;
  width: 104px;
  height: 50px;
  margin-left: 5px;
  border: 1px solid #e0e0e0;
  border-radius: 5px;
  background: #a9fff9;
  color: #fff;
  font-size: 20px;
  cursor: pointer;
}

/* ===== 右侧快捷入口 ===== */
.mp-menu {
  position: absolute;
  top: 15%;
  right: 0;
  width: 60px;
  /* 高度由内联 style 按入口数量算（见 menuHeight），这里只封顶避免超出视口 */
  max-height: 78vh;
  overflow: hidden;
  background: #fff;
  border-radius: 50px;
  /* 关闭：等整体落回原位（1.25s）再展开；宽度时长由 --mp-menu 单独控制 */
  transition: width var(--mp-menu) var(--mp-ease) var(--mp-c4), height 0.3s var(--mp-ease);
}
.mp-menu.is-closed {
  width: 0;
  /* 第一步：立刻收起；宽度时长由 --mp-menu 单独控制 */
  transition: width var(--mp-menu) var(--mp-ease) var(--mp-d1), height 0.3s var(--mp-ease);
}
/* 编辑模式下条目可能变多，允许滚动查看 */
.mp-menu.is-editing { overflow-y: auto; }
.mp-icon {
  display: block;
  width: 50px;
  height: 50px;
  margin: 5px auto 0;
  padding: 0;
  overflow: hidden;
  border: 1px solid rgb(170, 204, 255);
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
}
.mp-icon img { display: block; width: 100%; height: 100%; object-fit: cover; }
.mp-icon--add {
  display: grid;
  place-items: center;
  border-style: dashed;
  border-color: #38c9bd;
  background: #f2fffe;
  color: #0b7a72;
  font-size: 26px;
  line-height: 1;
}

/* ===== 编辑入口与工具条 ===== */
.mp-editbtn {
  position: fixed;
  right: 14px;
  bottom: 14px;
  z-index: 30;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.32);
  font-size: 15px;
  cursor: pointer;
  opacity: 0.35;
  transition: opacity 0.2s, color 0.2s, background-color 0.2s, border-color 0.2s;
}
.mp-editbtn:hover {
  opacity: 1;
  border-color: #a9fff9;
  background: #a9fff9;
  color: #000;
}

.mp-editbar {
  position: fixed;
  right: 14px;
  bottom: 14px;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.74);
  backdrop-filter: blur(6px);
}
.mp-editbar__msg {
  max-width: 220px;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.72);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mp-editbar__msg.is-error { color: #ff9d9d; }
.mp-editbar__btn {
  padding: 5px 14px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 999px;
  background: transparent;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: background-color 0.2s, border-color 0.2s, color 0.2s;
}
.mp-editbar__btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.14); }
.mp-editbar__btn:disabled { opacity: 0.5; cursor: default; }
.mp-editbar__btn--primary {
  border-color: #a9fff9;
  background: #a9fff9;
  color: #06302c;
  font-weight: 600;
}
.mp-editbar__btn--primary:hover:not(:disabled) { background: #c6fffb; }

/* 「更改」入口：贴在下方黑条（编辑工具条）的右上角，与工具条右上角齐平 */
.mp-changebtn {
  position: absolute;
  right: 0;
  bottom: 100%;
  padding: 6px 18px;
  border: 1px solid rgba(169, 255, 249, 0.5);
  border-bottom: 0;
  border-radius: 12px 12px 0 0;
  background: rgba(0, 0, 0, 0.74);
  color: #a9fff9;
  font-size: 13px;
  cursor: pointer;
  backdrop-filter: blur(6px);
  transition: background-color 0.2s, color 0.2s, border-color 0.2s;
}
.mp-changebtn:hover { background: #a9fff9; color: #06302c; border-color: #a9fff9; }

/* ===== 入口编辑弹窗 ===== */
.mp-modal {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.62);
}
.mp-modal__panel {
  width: min(430px, 100%);
  padding: 22px;
  border: 1px solid var(--gg-border);
  border-radius: var(--gg-radius);
  background: var(--gg-surface);
  color: var(--gg-ink);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.4);
}
.mp-modal__title { margin: 0 0 16px; font-size: 1.15rem; }
.mp-modal__panel--wide { width: min(560px, 100%); }

/* 查看器图片列表：缩略图网格 + 末尾的「＋」上传位 */
.mp-thumbs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  gap: 10px;
  margin-top: 8px;
}
.mp-thumb {
  position: relative;
  aspect-ratio: 1 / 1;
  overflow: hidden;
  border: 1px solid var(--gg-border);
  border-radius: 10px;
  background: var(--gg-surface-2);
}
.mp-thumb img { display: block; width: 100%; height: 100%; object-fit: cover; }
.mp-thumb__del {
  position: absolute;
  top: 4px;
  right: 4px;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.62);
  color: #fff;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition: background-color 0.2s;
}
.mp-thumb__del:hover { background: #b3261e; }
.mp-thumb--add {
  display: grid;
  place-items: center;
  border-style: dashed;
  border-color: #38c9bd;
  background: #f2fffe;
  color: #0b7a72;
  font-size: 26px;
  line-height: 1;
  cursor: pointer;
}
.mp-thumb--add:disabled { opacity: 0.6; cursor: default; }

.mp-field { display: block; margin-top: 12px; }
.mp-field__label {
  display: block;
  margin-bottom: 5px;
  color: var(--gg-inksoft);
  font-size: 0.84rem;
}
.mp-field__row { display: flex; align-items: center; gap: 10px; }
.mp-field__input {
  flex: 1;
  min-width: 0;
  width: 100%;
  height: 38px;
  padding: 0 10px;
  border: 1px solid var(--gg-border);
  border-radius: 8px;
  background: var(--gg-surface);
  color: var(--gg-ink);
  font-family: var(--gg-font);
  font-size: 0.9rem;
  outline: none;
}
.mp-field__input:focus { border-color: var(--gg-ink); }
.mp-field__preview {
  flex: none;
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  overflow: hidden;
  border: 1px solid var(--gg-border);
  border-radius: 50%;
  background: var(--gg-surface-2);
}
.mp-field__preview img { width: 100%; height: 100%; object-fit: cover; }

.mp-modal__error { margin: 12px 0 0; color: #c0392b; font-size: 0.84rem; }

.mp-modal__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 20px;
}
.mp-modal__spacer { flex: 1; }
.mp-mbtn {
  padding: 7px 16px;
  border: 1px solid var(--gg-border);
  border-radius: 8px;
  background: var(--gg-surface);
  color: var(--gg-ink);
  font-size: 0.88rem;
  cursor: pointer;
  transition: background-color 0.2s, border-color 0.2s;
}
.mp-mbtn:hover { background: var(--gg-surface-2); }
.mp-mbtn--primary {
  border-color: var(--gg-accent-bright);
  background: var(--gg-accent-bright);
  color: #fff;
}
.mp-mbtn--primary:hover { background: #333; }
.mp-mbtn--danger { border-color: #e2b4b4; color: #b3261e; }
.mp-mbtn--danger:hover { background: #fdf0f0; }

.mp-toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  z-index: 50;
  padding: 9px 18px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.78);
  color: #fff;
  font-size: 13px;
  transform: translateX(-50%);
}

/* ===== 头像浏览器 ===== */
.mp-viewer {
  position: fixed;
  inset: 0;
  z-index: 10;
  width: 100%;
  height: 0%;
  margin: auto;
  overflow: hidden;
  background: #000;
  border-radius: 15px;
  pointer-events: none;
  /* 关闭：立刻纵向收起 */
  transition: height var(--mp-step) var(--mp-ease) var(--mp-c1);
}
.mp-viewer.is-open {
  height: 100%;
  pointer-events: auto;
  /* 第四步：整体收完后（1.25s）再纵向展开 */
  transition: height var(--mp-step) var(--mp-ease) var(--mp-d4);
}
/* 标题：固定在顶部最终位置，从顶部往下纵向展开（clip 掉底部 100%，逐步露出整行），
   不跟随舞台的纵向拉伸上下移动 */
.mp-viewer__title {
  position: fixed;
  top: 20px;
  left: 0;
  right: 0;
  z-index: 12;
  color: #fff;
  font-family: 'Times New Roman', Times, serif;
  font-size: 44px;
  font-weight: 700;
  text-align: center;
  pointer-events: none;
  clip-path: inset(0 0 100% 0);
  transition: clip-path var(--mp-step) var(--mp-ease) var(--mp-c1);
}
.mp-viewer__title.is-open {
  clip-path: inset(0 0 0 0);
  transition: clip-path var(--mp-step) var(--mp-ease) var(--mp-d4);
}
.mp-viewer__stage {
  position: fixed;
  inset: 0;
  z-index: 11;
  width: 90vh;
  height: 0vh;
  margin: auto;
  overflow: hidden;
  border-radius: 15px;
  transition: height var(--mp-step) var(--mp-ease) var(--mp-c1);
}
.mp-viewer.is-open .mp-viewer__stage {
  height: 80vh;
  transition: height var(--mp-step) var(--mp-ease) var(--mp-d4);
}
.mp-viewer__stage img {
  position: absolute;
  width: 100%;
  height: auto;
  opacity: 0;
  transition: opacity 0.5s ease-in-out;
}
.mp-viewer__stage img.is-active { opacity: 1; }

.mp-viewer__nav {
  position: absolute;
  top: 50%;
  margin-top: -22px;
  padding: 16px;
  border: 0;
  background: transparent;
  color: #fff;
  font-size: 18px;
  font-weight: 700;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.6s ease;
}
.mp-viewer__nav:hover { background-color: rgba(0, 0, 0, 0.5); }
.mp-viewer__nav--prev { left: 10px; }
.mp-viewer__nav--next { right: 10px; }

.mp-viewer__esc {
  position: fixed;
  right: 2.5%;
  bottom: 2.5%;
  z-index: 13;
  padding: 8px 20px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 999px;
  background: transparent;
  color: #fff;
  font-size: 16px;
  line-height: 1.2;
  cursor: pointer;
  pointer-events: none;
  /* 第四步：与标题一起在固定位置从中央向两侧横向展开；圆角做成胶囊 */
  clip-path: inset(0 50% 0 50% round 999px);
  opacity: 0;
  transition: clip-path var(--mp-step) var(--mp-ease) var(--mp-c1),
    opacity var(--mp-step) var(--mp-ease) var(--mp-c1),
    background-color 0.2s ease, color 0.2s ease;
}
.mp-viewer__esc.is-open {
  clip-path: inset(0 0 0 0 round 999px);
  opacity: 1;
  pointer-events: auto;
  transition: clip-path var(--mp-step) var(--mp-ease) var(--mp-d4),
    opacity var(--mp-step) var(--mp-ease) var(--mp-d4),
    background-color 0.2s ease, color 0.2s ease;
}
.mp-viewer__esc:hover { background: #fff; color: #000; }

@media (prefers-reduced-motion: reduce) {
  .mp-cover,
  .mp-cover img,
  .mp-avatar,
  .mp-navblock-b,
  .mp-searchclip,
  .mp-menu,
  .mp-viewer,
  .mp-viewer__stage,
  .mp-viewer__title,
  .mp-viewer__esc { transition: none; }
}
</style>
