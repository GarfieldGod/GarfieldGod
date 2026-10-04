<script setup lang="ts">
// 从媒体库挑一张图：这里只列媒体库目录，文章私有图片不会出现在这里。
// 选中后由调用方决定用途（插入正文 / 设为封面 / 设为头图）。
const emit = defineEmits<{
  (e: 'select', url: string): void
  (e: 'close'): void
}>()

const { data, pending } = await useFetch<{ files: MediaItem[] }>('/api/admin/media', { key: 'admin-media' })

const keyword = ref('')
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif']
const isImage = (name: string) => IMAGE_EXT.some((ext) => name.toLowerCase().endsWith(ext))

const images = computed(() => {
  const list = (data.value?.files ?? []).filter((f) => isImage(f.name))
  const kw = keyword.value.trim().toLowerCase()
  return kw ? list.filter((f) => f.name.toLowerCase().includes(kw)) : list
})

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div class="mpick" @click.self="emit('close')">
      <div class="mpick__panel" role="dialog" aria-modal="true" aria-label="从媒体库选择图片">
        <div class="mpick__head">
          <div>
            <h2 class="mpick__title">从媒体库选择</h2>
            <p class="mpick__hint">媒体库的图片独立于文章，删除文章不会删掉它们。</p>
          </div>
          <div class="mpick__tools">
            <input v-model="keyword" class="ad-input" type="search" placeholder="搜索文件名" />
            <a class="ad-btn" href="/admin/media" target="_blank" rel="noopener">管理媒体库</a>
          </div>
        </div>

        <div class="mpick__body">
          <p v-if="pending" class="ad-hint">正在读取媒体库…</p>
          <div v-else-if="images.length" class="ad-media">
            <button
              v-for="f in images"
              :key="f.path"
              class="mpick__item"
              type="button"
              :title="f.name"
              @click="emit('select', f.url)"
            >
              <img class="ad-media__thumb" :src="f.url" :alt="f.name" loading="lazy" />
              <span class="ad-media__name">{{ f.name }}</span>
            </button>
          </div>
          <p v-else class="ad-empty">
            媒体库还没有图片。可以到「媒体库」上传，或在文章里直接上传——那类图片只属于这篇文章。
          </p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.mpick {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.6);
}
.mpick__panel {
  width: min(880px, 100%);
  max-height: 82vh;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  background: var(--gg-surface);
  border: 1px solid var(--gg-border);
  border-radius: var(--gg-radius);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
}
.mpick__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 22px;
  border-bottom: 1px solid var(--gg-border);
}
.mpick__title { margin: 0; font-size: 1.15rem; }
.mpick__hint { margin: 6px 0 0; color: var(--gg-muted); font-size: 0.84rem; }
.mpick__tools { display: flex; flex: none; align-items: center; gap: 8px; }
.mpick__tools .ad-input { width: 180px; }
.mpick__body { padding: 18px 22px; overflow-y: auto; }

.mpick__item {
  display: grid;
  padding: 0;
  border: 1px solid var(--gg-border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--gg-surface);
  text-align: left;
  cursor: pointer;
}
.mpick__item:hover { border-color: var(--gg-ink); }
.mpick__item .ad-media__name { padding: 8px 10px; }

@media (max-width: 640px) {
  .mpick__head { flex-direction: column; }
  .mpick__tools { width: 100%; }
  .mpick__tools .ad-input { flex: 1; width: auto; }
}
</style>