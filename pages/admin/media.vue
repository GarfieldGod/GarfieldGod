<script setup lang="ts">
import { sessionCachedData } from '~/composables/useSiteData'
import { thumbSrc } from '~/utils/media'

definePageMeta({ layout: 'admin' })
useHead({ title: '独立媒体库 — GarfieldGod 后台' })

const { data, refresh } = useFetch<{ files: LibraryFile[] }>('/api/admin/media', {
  key: 'admin-media',
  getCachedData: sessionCachedData,
})

const uploading = ref(false)
const dragOver = ref(false)
const message = ref('')
const failed = ref(false)
const keyword = ref('')
const picker = ref<HTMLInputElement | null>(null)
/** 正在大图查看的文件，null 表示查看器关闭 */
const viewer = ref<LibraryFile | null>(null)

const files = computed(() => {
  const list = data.value?.files ?? []
  const kw = keyword.value.trim().toLowerCase()
  return kw ? list.filter((f) => f.name.toLowerCase().includes(kw)) : list
})

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif']
const isImage = (name: string) => IMAGE_EXT.some((ext) => name.toLowerCase().endsWith(ext))

async function upload(list: FileList | File[]) {
  const filesToSend = Array.from(list)
  if (!filesToSend.length) return
  uploading.value = true
  message.value = ''
  let ok = 0
  const errors: string[] = []

  for (const file of filesToSend) {
    try {
      const body = new FormData()
      body.append('file', file)
      await $fetch('/api/admin/media', { method: 'POST', body })
      ok += 1
    } catch (e) {
      errors.push(`${file.name}：${adminError(e, '上传失败')}`)
    }
  }

  await refresh()
  failed.value = errors.length > 0
  message.value = errors.length ? `${ok} 个成功，${errors.length} 个失败 —— ${errors.join('；')}` : `已上传 ${ok} 个文件。`
  uploading.value = false
}

function onDrop(event: DragEvent) {
  dragOver.value = false
  const list = event.dataTransfer?.files
  if (list?.length) upload(list)
}

async function copyUrl(url: string) {
  const absolute = `${location.origin}${url}`
  try {
    await navigator.clipboard.writeText(absolute)
    failed.value = false
    message.value = `已复制：${absolute}`
  } catch {
    failed.value = true
    message.value = `复制失败，请手动复制：${absolute}`
  }
}

// 改名只换基名，扩展名由服务端沿用原文件的
function baseName(name: string) {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
}

function extOf(name: string) {
  return name.split('.').pop()?.toUpperCase() ?? 'FILE'
}

// 只有图片能开大图查看，其它类型点了不做任何事
function openViewer(file: LibraryFile) {
  if (isImage(file.name)) viewer.value = file
}

// 引用情况既做卡片角标，也做删除前的后果提示
function refLabel(file: LibraryFile) {
  if (file.refPosts) return `${file.refPosts} 篇引用`
  return file.refPages ? '页面引用' : '未引用'
}

function refHint(file: LibraryFile) {
  if (file.refPosts) return `注意：正被 ${file.refPosts} 篇文章引用，删除后这些文章里会显示坏图。`
  if (file.refPages) return '注意：被页面正文或站点信息引用，删除后那里会显示坏图。'
  return '没有任何文章引用它，删除不会影响前台显示。'
}

async function rename(file: LibraryFile) {
  const input = prompt(`重命名「${file.name}」\n（扩展名保持不变）`, baseName(file.name))
  if (input === null) return
  const name = input.trim()
  if (!name || name === baseName(file.name)) return

  try {
    await $fetch('/api/admin/media', { method: 'PATCH', body: { path: file.path, name } })
    await refresh()
    failed.value = false
    message.value = `已重命名为 ${name}`
  } catch (e) {
    failed.value = true
    message.value = adminError(e, '重命名失败')
  }
}

async function remove(file: LibraryFile) {
  if (!confirm(`确定删除「${file.name}」？\n文件会被直接删除，无法恢复。\n${refHint(file)}`)) return

  try {
    await $fetch('/api/admin/media', { method: 'DELETE', query: { path: file.path } })
    if (viewer.value?.path === file.path) viewer.value = null
    await refresh()
    failed.value = false
    message.value = `已删除 ${file.name}`
  } catch (e) {
    failed.value = true
    message.value = adminError(e, '删除失败')
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') viewer.value = null
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div>
    <div class="ad-head">
      <div>
        <h1 class="ad-title">独立媒体库</h1>
        <p class="ad-sub">
          共 {{ data?.files.length ?? 0 }} 个文件 · 单文件上限 20MB ·
        </p>
      </div>
      <div class="ad-actions">
        <input v-model="keyword" class="ad-input" type="search" placeholder="搜索文件名" style="width: 200px" />
        <button class="ad-btn ad-btn--primary" type="button" :disabled="uploading" @click="picker?.click()">
          {{ uploading ? '上传中…' : '上传文件' }}
        </button>
        <input
          ref="picker"
          type="file"
          accept="image/*,video/mp4,video/webm,audio/mpeg"
          multiple
          hidden
          @change="($event.target as HTMLInputElement).files && upload(($event.target as HTMLInputElement).files!)"
        />
      </div>
    </div>

    <p v-if="message" class="ad-msg" :class="failed ? 'is-error' : 'is-ok'">{{ message }}</p>

    <div
      class="ad-drop"
      :class="{ 'is-over': dragOver }"
      @dragover.prevent="dragOver = true"
      @dragleave.prevent="dragOver = false"
      @drop.prevent="onDrop"
    >
      把文件拖到这里上传（图片 / MP4 / WebM / MP3）
    </div>

    <div v-if="files.length" class="ad-media" style="margin-top: 16px">
      <figure v-for="f in files" :key="f.path" class="ad-media__item">
        <div class="ad-media__cover">
          <button
            class="ad-media__open"
            type="button"
            :title="isImage(f.name) ? `查看 ${f.name}` : f.name"
            @click="openViewer(f)"
          >
            <SmartImage
              v-if="isImage(f.name)"
              class="ad-media__thumb"
              :src="thumbSrc(f.url)"
              :fallback="f.url"
              :alt="f.name"
            />
            <span v-else class="ad-media__thumb ad-media__thumb--file">{{ extOf(f.name) }}</span>
          </button>
          <span class="ad-media__badge" :class="{ 'is-quiet': !f.refPosts && !f.refPages }">
            {{ refLabel(f) }}
          </span>
        </div>

        <figcaption class="ad-media__meta">
          <span class="ad-media__row">
            <span class="ad-media__name" :title="f.name">{{ f.name }}</span>
            <span class="ad-media__size" :title="formatSize(f.size)">{{ formatSize(f.size) }}</span>
          </span>
          <span class="ad-media__row">
            <span class="ad-media__date" :title="formatDateTime(f.mtime)">{{ formatDateTime(f.mtime) }}</span>
            <span class="ad-media__acts">
              <button class="ad-btn ad-btn--sm" type="button" @click="copyUrl(f.url)">复制</button>
              <button class="ad-btn ad-btn--sm" type="button" @click="rename(f)">重命名</button>
              <button class="ad-btn ad-btn--sm ad-btn--danger" type="button" @click="remove(f)">删除</button>
            </span>
          </span>
        </figcaption>
      </figure>
    </div>
    <p v-else class="ad-empty">还没有上传任何文件。</p>

    <!-- 大图查看：固定尺寸的取景框，图片按 contain 完整放进框内 -->
    <Teleport to="body">
      <div v-if="viewer" class="mview" @click.self="viewer = null">
        <figure class="mview__panel">
          <div class="mview__bar">
            <span class="mview__name" :title="viewer.name">{{ viewer.name }}</span>
            <button class="ad-btn ad-btn--sm" type="button" @click="viewer = null">关闭</button>
          </div>
          <div class="mview__stage">
            <img :src="viewer.url" :alt="viewer.name" />
          </div>
          <figcaption class="mview__foot">
            {{ formatSize(viewer.size) }} · {{ formatDateTime(viewer.mtime) }} · {{ refLabel(viewer) }}
          </figcaption>
        </figure>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* ---------- 卡片封面 ---------- */
.ad-media__cover { position: relative; }
/* 整块封面即查看入口：清掉按钮默认样式，别让它改变缩略图尺寸 */
.ad-media__open {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  cursor: zoom-in;
}
/* 引用次数角标压在封面左上角，不占 meta 的两行位置 */
.ad-media__badge {
  position: absolute;
  top: 6px;
  left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  font-size: 0.66rem;
  line-height: 1.5;
  pointer-events: none;
}
.ad-media__badge.is-quiet { background: rgba(0, 0, 0, 0.38); }

.ad-media__thumb--file {
  display: grid;
  place-items: center;
  color: var(--gg-muted);
  font-size: 0.8rem;
  letter-spacing: 0.08em;
}

/* ---------- 大图查看器 ---------- */
.mview {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.72);
}
/* 固定尺寸取景框：宽高都封顶，图片在框内 contain，保证整张可见 */
.mview__panel {
  width: min(1080px, 100%);
  height: min(760px, 100%);
  margin: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
  background: var(--gg-surface);
  border-radius: var(--gg-radius);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.3);
}
.mview__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--gg-border);
}
.mview__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.88rem; }
.mview__stage {
  min-height: 0;
  padding: 16px;
  background: var(--gg-surface-2);
}
/* 必须给死宽高再配合 contain：只写 max-* 的话小图会保持原始像素尺寸，
   在大取景框里缩成一小块，看着像没自适应 */
.mview__stage img { display: block; width: 100%; height: 100%; object-fit: contain; }
.mview__foot {
  padding: 10px 16px;
  border-top: 1px solid var(--gg-border);
  color: var(--gg-muted);
  font-size: 0.78rem;
}
</style>
