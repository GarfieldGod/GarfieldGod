<script setup lang="ts">
import { sessionCachedData } from '~/composables/useSiteData'
import { thumbSrc } from '~/utils/media'

definePageMeta({ layout: 'admin' })
useHead({ title: '独立媒体库 — GarfieldGod 后台' })

// 两个视图：独立媒体库（可增删改）与文章私有资源（只读）
type MediaView = 'library' | 'posts'

const view = ref<MediaView>('library')
const isLibrary = computed(() => view.value === 'library')

const { data, refresh } = useFetch<{ files: LibraryFile[] }>('/api/admin/media', {
  key: 'admin-media',
  getCachedData: sessionCachedData,
})

// 文章私有资源只在切到该视图时取一次，不拖慢媒体库本身的打开
const {
  data: postData,
  refresh: refreshPosts,
  pending: postsPending,
} = useFetch<{ files: PostMediaFile[] }>('/api/admin/media', {
  key: 'admin-post-media',
  query: { scope: 'posts' },
  getCachedData: sessionCachedData,
  immediate: false,
})

const uploading = ref(false)
const dragOver = ref(false)
const message = ref('')
const failed = ref(false)
const keyword = ref('')
const picker = ref<HTMLInputElement | null>(null)
/** 正在查看的文件，null 表示查看器关闭 */
const viewer = ref<MediaItem | null>(null)
/** 正在「复制到媒体库」的文件 path，用于禁用按钮防连点 */
const copying = ref('')

function setView(next: MediaView) {
  if (next === view.value) return
  view.value = next
  // 换视图时把查看器、搜索和提示一起收掉，避免残留上一个视图的状态
  viewer.value = null
  keyword.value = ''
  message.value = ''
  if (next === 'posts' && !postData.value) refreshPosts()
}

const total = computed(() =>
  isLibrary.value ? (data.value?.files.length ?? 0) : (postData.value?.files.length ?? 0),
)

const files = computed<MediaItem[]>(() => {
  const list: MediaItem[] = isLibrary.value ? (data.value?.files ?? []) : (postData.value?.files ?? [])
  const kw = keyword.value.trim().toLowerCase()
  return kw ? list.filter((f) => f.name.toLowerCase().includes(kw)) : list
})

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif']
const VIDEO_EXT = ['.mp4', '.webm']
const AUDIO_EXT = ['.mp3', '.wav', '.m4a', '.ogg', '.aac']

type FileKind = 'image' | 'video' | 'audio' | 'file'

function kindOf(name: string): FileKind {
  const n = name.toLowerCase()
  if (IMAGE_EXT.some((ext) => n.endsWith(ext))) return 'image'
  if (VIDEO_EXT.some((ext) => n.endsWith(ext))) return 'video'
  if (AUDIO_EXT.some((ext) => n.endsWith(ext))) return 'audio'
  return 'file'
}

const isImage = (name: string) => kindOf(name) === 'image'
// 图片看大图，视频与音频直接在查看器里播；其它类型只给复制地址
const canPreview = (name: string) => kindOf(name) !== 'file'

const viewerKind = computed<FileKind>(() => (viewer.value ? kindOf(viewer.value.name) : 'image'))

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

// 文章私有资源想长期复用（比如放进歌单、别的文章引用）时，另存一份到媒体库。
// 原文件不动，文章里的引用照旧。
async function copyToLibrary(file: MediaItem) {
  const p = file as PostMediaFile
  copying.value = file.path
  try {
    const res = await $fetch<{ file: MediaItem }>('/api/admin/media/copy', {
      method: 'POST',
      body: { path: `posts/${p.postId}/${p.path}` },
    })
    failed.value = false
    message.value = `已复制到媒体库：${res.file.name}`
    // 媒体库多了一个文件，重新取一次，切回去就是最新的
    await refresh()
  } catch (e) {
    failed.value = true
    message.value = adminError(e, '复制失败')
  } finally {
    copying.value = ''
  }
}

function openViewer(file: MediaItem) {
  if (canPreview(file.name)) viewer.value = file
}

// 媒体库看引用次数，私有资源看归属文章
function refLabel(file: MediaItem) {
  if (!isLibrary.value) {
    const p = file as PostMediaFile
    return p.postTitle ? `#${p.postId} · ${p.postTitle}` : `#${p.postId}`
  }
  const lib = file as LibraryFile
  if (lib.refPosts) return `${lib.refPosts} 篇引用`
  return lib.refPages ? '页面引用' : '未引用'
}

function refQuiet(file: MediaItem) {
  if (!isLibrary.value) return false
  const lib = file as LibraryFile
  return !lib.refPosts && !lib.refPages
}

function refHint(file: MediaItem) {
  if (!isLibrary.value) return '文章私有资源随文章删除，这里只读。'
  const lib = file as LibraryFile
  if (lib.refPosts) return `注意：正被 ${lib.refPosts} 篇文章引用，删除后这些文章里会显示坏图。`
  if (lib.refPages) return '注意：被页面正文或站点信息引用，删除后那里会显示坏图。'
  return '没有任何文章引用它，删除不会影响前台显示。'
}

async function rename(file: MediaItem) {
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

async function remove(file: MediaItem) {
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
          共 {{ total }} 个文件 ·
          {{ isLibrary ? '单文件上限 20MB · 可被任意文章引用' : '文章私有资源 · 只读' }}
        </p>
      </div>
      <div class="ad-actions">
        <input v-model="keyword" class="ad-input" type="search" placeholder="搜索文件名" style="width: 200px" />
        <button
          v-if="isLibrary"
          class="ad-btn ad-btn--primary"
          type="button"
          :disabled="uploading"
          @click="picker?.click()"
        >
          {{ uploading ? '上传中…' : '上传文件' }}
        </button>
        <input
          v-if="isLibrary"
          ref="picker"
          type="file"
          accept="image/*,video/mp4,video/webm,audio/mpeg"
          multiple
          hidden
          @change="($event.target as HTMLInputElement).files && upload(($event.target as HTMLInputElement).files!)"
        />
      </div>
    </div>

    <div class="ad-seg" role="tablist" aria-label="媒体库视图">
      <button
        class="ad-seg__btn"
        :class="{ 'is-on': isLibrary }"
        type="button"
        role="tab"
        :aria-selected="isLibrary"
        @click="setView('library')"
      >
        独立媒体库
      </button>
      <button
        class="ad-seg__btn"
        :class="{ 'is-on': !isLibrary }"
        type="button"
        role="tab"
        :aria-selected="!isLibrary"
        @click="setView('posts')"
      >
        文章私有资源
      </button>
    </div>

    <p v-if="message" class="ad-msg" :class="failed ? 'is-error' : 'is-ok'">{{ message }}</p>

    <p v-if="!isLibrary" class="ad-hint" style="margin-top: 12px">
      这些文件归各自文章所有，随文章一起删除。这里只读：可以预览、复制地址，但不能改名或删除——改了文章正文里会留下坏图。想长期复用就点「复制到媒体库」，会另存一份独立文件。
    </p>

    <div
      v-if="isLibrary"
      class="ad-drop"
      :class="{ 'is-over': dragOver }"
      @dragover.prevent="dragOver = true"
      @dragleave.prevent="dragOver = false"
      @drop.prevent="onDrop"
    >
      把文件拖到这里上传（图片 / MP4 / WebM / MP3）
    </div>

    <p v-if="!isLibrary && postsPending" class="ad-hint" style="margin-top: 16px">正在读取文章私有资源…</p>

    <div v-if="files.length" class="ad-media" style="margin-top: 16px">
      <figure v-for="f in files" :key="f.path" class="ad-media__item">
        <div class="ad-media__cover">
          <button
            class="ad-media__open"
            :class="{ 'is-zoom': isImage(f.name) }"
            type="button"
            :title="canPreview(f.name) ? `查看 ${f.name}` : f.name"
            @click="openViewer(f)"
          >
            <SmartImage
              v-if="kindOf(f.name) === 'image'"
              class="ad-media__thumb"
              :src="thumbSrc(f.url)"
              :fallback="f.url"
              :alt="f.name"
            />
            <video
              v-else-if="kindOf(f.name) === 'video'"
              class="ad-media__thumb ad-media__thumb--video"
              :src="f.url"
              preload="metadata"
              muted
              playsinline
            />
            <span v-else class="ad-media__thumb ad-media__thumb--file">
              <svg
                v-if="kindOf(f.name) === 'audio'"
                class="ad-media__note"
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 2v8.3a2.7 2.7 0 11-1.4-2.4V4.1L6.6 5v6.9A2.7 2.7 0 115.2 9.5V4z" />
              </svg>
              <span>{{ extOf(f.name) }}</span>
            </span>
            <span v-if="kindOf(f.name) === 'video'" class="ad-media__play" aria-hidden="true">
              <svg viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 3.2v9.6L13 8z" /></svg>
            </span>
          </button>
          <span class="ad-media__badge" :class="{ 'is-quiet': refQuiet(f) }">{{ refLabel(f) }}</span>
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
              <template v-if="isLibrary">
                <button class="ad-btn ad-btn--sm" type="button" @click="rename(f)">重命名</button>
                <button class="ad-btn ad-btn--sm ad-btn--danger" type="button" @click="remove(f)">删除</button>
              </template>
            </span>
          </span>
          <button
            v-if="!isLibrary"
            class="ad-btn ad-btn--sm ad-media__copy"
            type="button"
            :disabled="copying === f.path"
            @click="copyToLibrary(f)"
          >
            {{ copying === f.path ? '复制中…' : '复制到媒体库' }}
          </button>
        </figcaption>
      </figure>
    </div>
    <p v-else-if="!postsPending" class="ad-empty">
      {{
        total
          ? `没有匹配「${keyword.trim()}」的文件。`
          : isLibrary
            ? '还没有上传任何文件。'
            : '还没有文章私有资源。'
      }}
    </p>

    <!-- 查看：图片按 contain 放进固定取景框，视频/音频直接播放 -->
    <Teleport to="body">
      <div v-if="viewer" class="mview" @click.self="viewer = null">
        <figure class="mview__panel">
          <div class="mview__bar">
            <span class="mview__name" :title="viewer.name">{{ viewer.name }}</span>
            <button class="ad-btn ad-btn--sm" type="button" @click="viewer = null">关闭</button>
          </div>
          <div class="mview__stage" :class="`is-${viewerKind}`">
            <img v-if="viewerKind === 'image'" :src="viewer.url" :alt="viewer.name" />
            <video v-else-if="viewerKind === 'video'" :src="viewer.url" controls autoplay playsinline />
            <audio v-else-if="viewerKind === 'audio'" :src="viewer.url" controls autoplay />
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
  cursor: pointer;
}
/* 只有图片是「放大看」，视频/音频点开是播放，光标区分开 */
.ad-media__open.is-zoom { cursor: zoom-in; }
/* 引用次数角标压在封面左上角，不占 meta 的两行位置 */
.ad-media__badge {
  position: absolute;
  top: 6px;
  left: 6px;
  max-width: calc(100% - 12px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  font-size: 0.66rem;
  line-height: 1.5;
  pointer-events: none;
}
.ad-media__badge.is-quiet { background: rgba(0, 0, 0, 0.38); }
/* 私有资源的「复制到媒体库」独占一行：卡片只有五分之一宽，挤进操作行会折行 */
.ad-media__copy { width: 100%; justify-content: center; }

.ad-media__thumb--file {
  display: grid;
  place-items: center;
  gap: 2px;
  color: var(--gg-muted);
  font-size: 0.8rem;
  letter-spacing: 0.08em;
}
/* 视频封面取首帧：与图片一样铺满卡片 */
.ad-media__thumb--video { object-fit: cover; background: #000; }
.ad-media__note { width: 26px; height: 26px; }
/* 播放标识压正中，提示这块封面点开是播视频 */
.ad-media__play {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  pointer-events: none;
}
.ad-media__play svg { width: 18px; height: 18px; }

/* ---------- 查看器 ---------- */
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
.mview__stage video { display: block; width: 100%; height: 100%; object-fit: contain; background: #000; }
/* 音频没有画面，居中放一条播放条就够 */
.mview__stage.is-audio { display: grid; place-items: center; }
.mview__stage.is-audio audio { width: min(560px, 100%); }
.mview__foot {
  padding: 10px 16px;
  border-top: 1px solid var(--gg-border);
  color: var(--gg-muted);
  font-size: 0.78rem;
}
</style>
