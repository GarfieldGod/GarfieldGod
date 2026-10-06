<script setup lang="ts">
import { marked } from 'marked'
import type { TagRef } from '~/composables/useSiteData'
import { resolvePostStyleOptions, sessionCachedData } from '~/composables/useSiteData'

definePageMeta({ layout: 'admin' })
useHead({ title: '批量导入 — GarfieldGod 后台' })

const { data: pagesData } = useFetch<{ pages: AdminNavPage[]; tags: TagRef[] }>(
  '/api/admin/nav-pages',
  { key: 'admin-nav-pages', getCachedData: sessionCachedData },
)

// 与编辑页一致的页面树构造：父节点穿过、posts 节点收录
const pageOptions = computed(() => {
  const byParent = new Map<number, AdminNavPage[]>()
  for (const p of pagesData.value?.pages ?? []) {
    const arr = byParent.get(p.parentId) ?? []
    arr.push(p)
    byParent.set(p.parentId, arr)
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)

  const out: { id: number; label: string }[] = []
  const walk = (parentId: number, depth: number) => {
    for (const page of byParent.get(parentId) ?? []) {
      const listed = page.contentSource === 'posts'
      if (listed) out.push({ id: page.id, label: `${'　'.repeat(depth)}${page.title}` })
      walk(page.id, listed ? depth + 1 : depth)
    }
  }
  walk(0, 0)
  return out
})

const pageTitle = computed(() => {
  const map = new Map<number, string>()
  for (const p of pagesData.value?.pages ?? []) map.set(p.id, p.title)
  return map
})

const tagsByPage = computed(() => {
  const map = new Map<number, TagRef[]>()
  for (const t of pagesData.value?.tags ?? []) {
    const arr = map.get(t.pageId) ?? []
    arr.push(t)
    map.set(t.pageId, arr)
  }
  return map
})

// 导入设置：全局统一，作用于所有待导入文章
const form = reactive({
  pageIds: [] as number[],
  tagIds: [] as number[],
  status: 'draft' as 'draft' | 'published',
  format: 'markdown' as 'markdown' | 'html',
  contentWidth: '' as '' | 'wide' | 'normal' | 'narrow',
  postStyle: 'toc' as '' | 'classic' | 'toc' | 'magazine' | 'cards' | 'link',
  postStyleOptions: resolvePostStyleOptions({ tocSide: 'right', tocProgress: true }),
  allowComments: true,
})

// 取消勾选页面时，它持有的标签勾选一并撤销
watch(
  () => [...form.pageIds],
  () => {
    const allowed = new Set<number>()
    for (const id of form.pageIds) for (const t of tagsByPage.value.get(id) ?? []) allowed.add(t.id)
    form.tagIds = form.tagIds.filter((id) => allowed.has(id))
  },
)

function toggleTag(id: number) {
  const i = form.tagIds.indexOf(id)
  if (i === -1) form.tagIds.push(id)
  else form.tagIds.splice(i, 1)
}

const STATUS_LABELS: Record<string, string> = { published: '已发布', draft: '草稿' }
const FORMAT_LABELS: Record<string, string> = { markdown: 'Markdown', html: 'HTML（老文章）' }
const CONTENT_WIDTH_LABELS: Record<string, string> = {
  '': '默认',
  wide: '宽幅',
  normal: '正常',
  narrow: '窄幅',
}
const TOC_SIDE_LABELS: Record<string, string> = { right: '右侧', left: '左侧' }
const HERO_SIZE_LABELS: Record<string, string> = { compact: '紧凑', standard: '标准', tall: '加高', none: '无大图' }
const STYLES_WITH_SETTINGS = ['toc', 'magazine', 'cards', 'link']
const styleHasSettings = computed(() => STYLES_WITH_SETTINGS.includes(form.postStyle))
const widthSettingVisible = computed(() => form.postStyle === '' || form.postStyle === 'classic')

// ===== 示例正文：覆盖各样式所需的标题结构 =====
const SAMPLE_CONTENT = `# 示例文章标题

这是一段引言正文，用来预览版式的整体观感。切到不同的文章样式，右栏会即时呈现对应的版式效果。

## 第一节 起手

这里是一段普通的正文。左文右栏方案会在右侧抽出目录，分节卡片方案会按二级标题切分。

- 列表项一
- 列表项二
- 列表项三

## 第二节 推进

第二段正文，用来观察段落间距、首字下沉、目录高亮等细节。

### 子小节

三级标题也会进入目录，但层级比二级标题低一档。

## 第三节 收束

最后一段正文，验证阅读进度条、迷你导航等收尾元素。`

const previewHtml = computed(() =>
  form.format === 'markdown' ? (marked.parse(SAMPLE_CONTENT, { async: false }) as string) : SAMPLE_CONTENT,
)
const previewPageLabels = computed(() =>
  form.pageIds.map((id) => pageTitle.value.get(id) ?? `页面 #${id}`),
)

// ===== 文件解析：front-matter + 正文 =====
interface ImportItem {
  id: string
  fileName: string
  title: string
  date: string
  content: string
  charCount: number
  tags: string[]
  removed: boolean
  state: 'pending' | 'importing' | 'done' | 'failed'
  error: string
}

const items = ref<ImportItem[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const dragOver = ref(false)

function parseFrontMatter(text: string): { data: Record<string, string>; body: string } {
  const data: Record<string, string> = {}
  if (!text.startsWith('---')) return { data, body: text }
  const end = text.indexOf('\n---', 3)
  if (end < 0) return { data, body: text }
  const head = text.slice(3, end).replace(/^\n+/, '')
  const body = text.slice(end + 4).replace(/^\n+/, '')
  for (const line of head.split('\n')) {
    const m = /^([a-zA-Z][\w-]*)\s*:\s*(.*)$/.exec(line.trim())
    if (m) data[m[1].toLowerCase()] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return { data, body }
}

function extractTitle(body: string, data: Record<string, string>, fileName: string): string {
  if (data.title) return data.title
  const m = /^#\s+(.+)$/m.exec(body)
  if (m) return m[1].trim()
  return fileName.replace(/\.[^.]+$/, '')
}

function extractTags(data: Record<string, string>): string[] {
  const raw = data.tags
  if (!raw) return []
  return raw.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
}

function extractDate(data: Record<string, string>, file: File): string {
  if (data.date) {
    const d = new Date(data.date)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  const d = new Date(file.lastModified)
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

async function readFiles(files: FileList | File[]) {
  const arr = Array.from(files).filter((f) => /\.md$/i.test(f.name) || f.type === 'text/markdown')
  const next: ImportItem[] = []
  for (const file of arr) {
    try {
      const text = await file.text()
      const { data, body } = parseFrontMatter(text)
      const title = extractTitle(body, data, file.name)
      const content = body
      next.push({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        fileName: file.name,
        title,
        date: extractDate(data, file),
        content,
        charCount: content.replace(/\s+/g, '').length,
        tags: extractTags(data),
        removed: false,
        state: 'pending',
        error: '',
      })
    } catch {
      // 读不出来的文件跳过
    }
  }
  // 同名文件去重：后来的覆盖先到的
  const map = new Map<string, ImportItem>()
  for (const it of next) map.set(it.fileName, it)
  items.value = [...map.values()]
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files?.length) readFiles(input.files)
  input.value = ''
}

function onDrop(e: DragEvent) {
  dragOver.value = false
  if (e.dataTransfer?.files?.length) readFiles(e.dataTransfer.files)
}

function removeItem(id: string) {
  const it = items.value.find((i) => i.id === id)
  if (it) it.removed = true
}

function restoreItem(id: string) {
  const it = items.value.find((i) => i.id === id)
  if (it) it.removed = false
}

function clearAll() {
  items.value = []
}

const validItems = computed(() => items.value.filter((i) => !i.removed))
const pendingItems = computed(() => validItems.value.filter((i) => i.state === 'pending'))
const doneCount = computed(() => validItems.value.filter((i) => i.state === 'done').length)
const failedCount = computed(() => validItems.value.filter((i) => i.state === 'failed').length)

// 重名检测：与服务端已有文章比对
const { data: existingPosts } = useFetch<{ posts: AdminPost[] }>('/api/admin/posts', {
  key: 'admin-posts',
  getCachedData: sessionCachedData,
})
const existingTitles = computed(
  () => new Set((existingPosts.value?.posts ?? []).map((p) => p.title)),
)

function isDup(item: ImportItem) {
  return existingTitles.value.has(item.title)
}

// ===== 导入执行：限 3 并发，逐篇 POST =====
const importing = ref(false)
const progress = ref(0)

async function importOne(item: ImportItem): Promise<void> {
  item.state = 'importing'
  try {
    // 标签按名字匹配到所选页面下的标签 id
    const allowedTags: TagRef[] = []
    for (const pid of form.pageIds) allowedTags.push(...(tagsByPage.value.get(pid) ?? []))
    const matchedTagIds: number[] = []
    for (const name of item.tags) {
      const hit = allowedTags.find((t) => t.name === name)
      if (hit) matchedTagIds.push(hit.id)
    }

    await $fetch('/api/admin/posts', {
      method: 'POST',
      body: {
        title: item.title,
        date: item.date,
        content: item.content,
        excerpt: '',
        featured: null,
        pageIds: form.pageIds,
        tagIds: matchedTagIds.length ? matchedTagIds : form.tagIds,
        status: form.status,
        format: form.format,
        contentWidth: form.contentWidth,
        postStyle: form.postStyle,
        postStyleOptions: form.postStyleOptions,
        allowComments: form.allowComments,
      },
    })
    item.state = 'done'
  } catch (e) {
    item.state = 'failed'
    item.error = adminError(e, '导入失败')
  }
}

async function runImport() {
  if (!form.pageIds.length) {
    alert('请先选择展示页面')
    return
  }
  if (!pendingItems.value.length) {
    alert('没有待导入的文章')
    return
  }
  importing.value = true
  progress.value = 0
  const queue = [...pendingItems.value]
  const total = queue.length
  let done = 0

  // 3 并发
  const CONCURRENCY = 3
  let cursor = 0
  async function worker() {
    while (cursor < queue.length) {
      const item = queue[cursor++]
      await importOne(item)
      done++
      progress.value = Math.round((done / total) * 100)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

  importing.value = false
  await refreshNuxtData('admin-posts')
}

// 导入中拦截路由离开
const beforeUnload = (e: BeforeUnloadEvent) => {
  if (importing.value) {
    e.preventDefault()
    e.returnValue = ''
  }
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
</script>

<template>
  <div>
    <div class="ad-head">
      <div>
        <h1 class="ad-title">批量导入</h1>
        <p class="ad-sub">
          <NuxtLink to="/admin/posts">文章</NuxtLink> / 批量导入
        </p>
      </div>
      <div class="ad-actions">
        <NuxtLink class="ad-btn" to="/admin/posts">返回文章列表</NuxtLink>
        <button
          class="ad-btn ad-btn--primary"
          type="button"
          :disabled="importing || !pendingItems.length || !form.pageIds.length"
          @click="runImport"
        >
          {{ importing ? `导入中 ${progress}%` : '开始导入' }}
        </button>
      </div>
    </div>

    <p class="ad-hint" style="margin: 0 0 16px">
      选择文件夹或拖入多个 .md 文件；样式、展示页面、标签等设置对全部文章统一生效。
      每篇的标题和日期从文件解析（front-matter 优先，否则取首个一级标题和文件修改时间）。
    </p>

    <div class="ad-work">
      <div class="ad-work__col">
        <!-- 基本信息：标题/日期/封面只读 -->
        <section class="ad-card">
          <div class="ad-card__head">
            <h2 class="ad-card__title">基本信息</h2>
            <span class="ad-hint">由文件解析</span>
          </div>
          <div class="ad-form">
            <label class="ad-f c6">
              <span>标题</span>
              <input class="ad-input is-readonly" type="text" value="从 front-matter 或文件名提取" readonly />
            </label>
            <label class="ad-f c3">
              <span>发布时间</span>
              <input class="ad-input is-readonly" type="text" value="从 front-matter 或文件修改时间" readonly />
            </label>
            <div class="ad-f c3">
              <span>状态</span>
              <div class="ad-seg ad-seg--block">
                <button
                  v-for="(label, key) in STATUS_LABELS"
                  :key="key"
                  type="button"
                  class="ad-seg__btn"
                  :class="{ 'is-on': form.status === key }"
                  @click="form.status = key as 'draft' | 'published'"
                >
                  {{ label }}
                </button>
              </div>
            </div>
            <div class="ad-f c6">
              <span>正文格式</span>
              <div class="ad-seg ad-seg--block" style="max-width: 360px">
                <button
                  v-for="(label, key) in FORMAT_LABELS"
                  :key="key"
                  type="button"
                  class="ad-seg__btn"
                  :class="{ 'is-on': form.format === key }"
                  @click="form.format = key as 'markdown' | 'html'"
                >
                  {{ label }}
                </button>
              </div>
            </div>
            <div class="ad-f c6">
              <span>留言</span>
              <button
                type="button"
                class="ad-sw"
                :class="{ 'is-off': !form.allowComments }"
                @click="form.allowComments = !form.allowComments"
              >
                <span class="ad-sw__track" />{{ form.allowComments ? '允许留言' : '不接受留言' }}
              </button>
            </div>
          </div>
        </section>

        <!-- 展示页面 -->
        <section class="ad-card">
          <div class="ad-card__head">
            <h2 class="ad-card__title">展示页面</h2>
          </div>
          <p class="ad-hint" style="margin: 0 0 12px">
            所有导入文章都会出现在勾选的页面下。
          </p>
          <div class="ad-checks">
            <label v-for="p in pageOptions" :key="p.id" class="ad-check">
              <input v-model="form.pageIds" type="checkbox" :value="p.id" />
              {{ p.label }}
            </label>
          </div>
          <p v-if="!pageOptions.length" class="ad-hint">
            还没有可承载文章的页面，请先到「页面」中新建。
          </p>
        </section>

        <!-- 标签 -->
        <section class="ad-card">
          <div class="ad-card__head">
            <h2 class="ad-card__title">标签</h2>
          </div>
          <p class="ad-hint" style="margin: 0 0 12px">
            默认标签对所有文章生效；文件 front-matter 里有 tags 时按名字匹配覆盖。
          </p>
          <div v-if="form.pageIds.length" class="ad-tag-groups">
            <div v-for="pid in form.pageIds" :key="pid" class="ad-tag-group">
              <div class="ad-tag-group__title">{{ pageTitle.get(pid) ?? `页面 #${pid}` }}</div>
              <div v-if="(tagsByPage.get(pid) ?? []).length" class="ad-chips">
                <button
                  v-for="t in tagsByPage.get(pid)"
                  :key="t.id"
                  type="button"
                  class="ad-toggle"
                  :class="{ 'is-on': form.tagIds.includes(t.id) }"
                  @click="toggleTag(t.id)"
                >
                  <i>{{ form.tagIds.includes(t.id) ? '✓' : '+' }}</i>{{ t.name }}
                </button>
              </div>
              <p v-else class="ad-hint">该页面暂无标签。</p>
            </div>
          </div>
          <p v-else class="ad-hint">请先选择展示页面。</p>
        </section>

        <!-- 封面与摘要：只读 -->
        <section class="ad-card">
          <div class="ad-card__head">
            <h2 class="ad-card__title">封面与摘要</h2>
            <span class="ad-hint">批量导入不设置</span>
          </div>
          <div class="ad-form">
            <label class="ad-f c6">
              <span>封面图地址</span>
              <input class="ad-input is-readonly" type="text" value="无（批量导入不设置封面）" readonly />
            </label>
            <label class="ad-f c6">
              <span>摘要</span>
              <input class="ad-input is-readonly" type="text" value="留空自动从正文截取" readonly />
            </label>
          </div>
        </section>

        <!-- 文章样式 -->
        <section class="ad-card">
          <div class="ad-card__head">
            <h2 class="ad-card__title">文章样式</h2>
          </div>
          <div class="ad-f c6">
            <span>样式方案</span>
            <div class="ad-seg ad-seg--block" style="max-width: 560px">
              <button
                v-for="(label, key) in POST_STYLE_LABELS"
                :key="key || 'default'"
                type="button"
                class="ad-seg__btn"
                :class="{ 'is-on': form.postStyle === key }"
                @click="form.postStyle = key as '' | 'classic' | 'toc' | 'magazine' | 'cards' | 'link'"
              >
                {{ label }}
              </button>
            </div>
          </div>
          <div v-if="styleHasSettings" class="ad-style-panel">
            <template v-if="form.postStyle === 'toc'">
              <div class="ad-f c6">
                <span>目录栏位置</span>
                <div class="ad-seg ad-seg--block" style="max-width: 320px">
                  <button
                    v-for="(label, key) in TOC_SIDE_LABELS"
                    :key="key"
                    type="button"
                    class="ad-seg__btn"
                    :class="{ 'is-on': form.postStyleOptions.tocSide === key }"
                    @click="form.postStyleOptions.tocSide = key as 'right' | 'left'"
                  >
                    {{ label }}
                  </button>
                </div>
                <p class="ad-hint" style="margin: 0">窄屏下目录栏会自动折到正文下方。</p>
              </div>
              <div class="ad-checks">
                <label class="ad-check">
                  <input v-model="form.postStyleOptions.tocProgress" type="checkbox" />
                  显示阅读进度
                </label>
              </div>
            </template>
            <template v-else-if="form.postStyle === 'magazine'">
              <div class="ad-f c6">
                <span>头图挡位</span>
                <div class="ad-seg ad-seg--block" style="max-width: 420px">
                  <button
                    v-for="(label, key) in HERO_SIZE_LABELS"
                    :key="key"
                    type="button"
                    class="ad-seg__btn"
                    :class="{ 'is-on': form.postStyleOptions.heroSize === key }"
                    @click="form.postStyleOptions.heroSize = key as 'compact' | 'standard' | 'tall' | 'none'"
                  >
                    {{ label }}
                  </button>
                </div>
                <p class="ad-hint" style="margin: 0">选「无大图」时不显示封面带，标题区改由白卡顶端承载。</p>
              </div>
              <div class="ad-f c6">
                <span>头图地址</span>
                <input class="ad-input is-readonly" type="text" value="批量导入不设置头图" readonly />
              </div>
              <div class="ad-checks">
                <label class="ad-check">
                  <input v-model="form.postStyleOptions.showByline" type="checkbox" />
                  显示个人信息栏（作者 / 日期 / 阅读数）
                </label>
                <label class="ad-check">
                  <input v-model="form.postStyleOptions.dropCap" type="checkbox" />
                  首字放大
                </label>
                <label class="ad-check">
                  <input v-model="form.postStyleOptions.showLabel" type="checkbox" />
                  显示所属页面标签
                </label>
                <label class="ad-check">
                  <input v-model="form.postStyleOptions.showLede" type="checkbox" />
                  显示摘要（导语）
                </label>
                <label class="ad-check">
                  <input v-model="form.postStyleOptions.centerTitle" type="checkbox" />
                  居中标题
                </label>
                <label class="ad-check">
                  <input v-model="form.postStyleOptions.fullWidthMedia" type="checkbox" />
                  正文图片撑满内容区
                </label>
              </div>
            </template>
            <template v-else-if="form.postStyle === 'cards'">
              <div class="ad-checks">
                <label class="ad-check">
                  <input v-model="form.postStyleOptions.miniNav" type="checkbox" />
                  顶部迷你导航
                </label>
                <label class="ad-check">
                  <input v-model="form.postStyleOptions.sectionNumbers" type="checkbox" />
                  显示「第 N 节」小节编号
                </label>
              </div>
            </template>
            <template v-else-if="form.postStyle === 'link'">
              <p class="ad-hint" style="margin: 0">超链接方案需要逐篇设置跳转地址，不适合批量导入。</p>
            </template>
          </div>
          <p v-else class="ad-hint" style="margin: 12px 0 0">
            该方案使用默认设置，没有额外的可调项。
          </p>
        </section>

        <!-- 导入列表（替代正文框） -->
        <section class="ad-card">
          <div class="ad-card__head">
            <h2 class="ad-card__title">导入列表</h2>
            <div class="ad-editor__toolbar">
              <span class="ad-hint">{{ validItems.length }} 篇 · 成功 {{ doneCount }} · 失败 {{ failedCount }}</span>
              <button class="ad-btn ad-btn--sm" type="button" @click="fileInput?.click()">打开文件夹</button>
              <button v-if="items.length" class="ad-btn ad-btn--sm" type="button" @click="clearAll">清空</button>
              <input
                ref="fileInput"
                type="file"
                webkitdirectory
                multiple
                accept=".md"
                hidden
                @change="onFileChange"
              />
            </div>
          </div>

          <!-- 拖拽区 -->
          <div
            class="ad-dropzone"
            :class="{ 'is-over': dragOver }"
            @dragover.prevent="dragOver = true"
            @dragleave.prevent="dragOver = false"
            @drop.prevent="onDrop"
          >
            <p v-if="!items.length" class="ad-hint" style="margin: 0">
              拖拽 .md 文件到此处，或点右上角「打开文件夹」选择文件。
            </p>
            <p v-else class="ad-hint" style="margin: 0">
              已加载 {{ validItems.length }} 篇，继续拖入可追加。
            </p>
          </div>

          <!-- 列表 -->
          <div v-if="items.length" class="ad-import-list">
            <div class="ad-import-row ad-import-row--head">
              <span class="ad-import-cell--title">标题</span>
              <span class="ad-import-cell--date">日期</span>
              <span class="ad-import-cell--count">字数</span>
              <span class="ad-import-cell--state">状态</span>
              <span class="ad-import-cell--action"></span>
            </div>
            <div
              v-for="it in items"
              :key="it.id"
              class="ad-import-row"
              :class="{ 'is-removed': it.removed, 'is-dup': !it.removed && isDup(it) }"
            >
              <span class="ad-import-cell--title">
                <input v-model="it.title" class="ad-input ad-input--inline" type="text" :disabled="it.removed || it.state === 'importing'" />
                <span v-if="isDup(it)" class="ad-hint" style="color: var(--gg-warn)">重名</span>
              </span>
              <span class="ad-import-cell--date">
                <input v-model="it.date" class="ad-input ad-input--inline" type="datetime-local" :disabled="it.removed || it.state === 'importing'" />
              </span>
              <span class="ad-import-cell--count ad-table__num">{{ it.charCount }}</span>
              <span class="ad-import-cell--state">
                <span v-if="it.state === 'pending'" class="ad-badge is-draft">待导入</span>
                <span v-else-if="it.state === 'importing'" class="ad-badge is-published">导入中</span>
                <span v-else-if="it.state === 'done'" class="ad-badge is-ok">成功</span>
                <span v-else class="ad-badge is-error">{{ it.error || '失败' }}</span>
              </span>
              <span class="ad-import-cell--action">
                <button v-if="!it.removed" class="ad-btn ad-btn--sm" type="button" :disabled="it.state === 'importing'" @click="removeItem(it.id)">移除</button>
                <button v-else class="ad-btn ad-btn--sm" type="button" @click="restoreItem(it.id)">恢复</button>
              </span>
            </div>
          </div>

          <!-- 进度条 -->
          <div v-if="importing" class="ad-progress">
            <div class="ad-progress__bar" :style="{ width: `${progress}%` }" />
          </div>
        </section>
      </div>

      <!-- 右栏：效果预览 -->
      <aside class="ad-preview-panel">
        <div class="ad-preview-panel__bar">
          <strong>效果预览</strong>
          <span>示例正文 · {{ form.postStyle ? POST_STYLE_LABELS[form.postStyle] : '默认' }}</span>
        </div>
        <div class="ad-preview-panel__body">
          <PostPreview
            title="示例文章标题"
            :content-html="previewHtml"
            date=""
            :page-labels="previewPageLabels"
            :is-draft="form.status === 'draft'"
            :content-width="form.contentWidth"
            :post-style="form.postStyle"
            :post-style-options="form.postStyleOptions"
          />
        </div>
        <div class="ad-preview-panel__foot">
          预览使用固定示例正文；实际导入的每篇文章保存后可在编辑页单独查看。
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
/* 只读输入框：浅灰底，提示此字段不可输入 */
.ad-input.is-readonly {
  background: var(--gg-surface-2);
  color: var(--gg-ink-soft, #888);
  cursor: not-allowed;
}

/* 拖拽区 */
.ad-dropzone {
  border: 2px dashed var(--gg-border);
  border-radius: 10px;
  padding: 16px 20px;
  text-align: center;
  transition: border-color 0.2s, background 0.2s;
}
.ad-dropzone.is-over {
  border-color: var(--gg-ink);
  background: var(--gg-surface-2);
}

/* 导入列表：表格化布局 */
.ad-import-list {
  margin-top: 12px;
  border: 1px solid var(--gg-border);
  border-radius: 10px;
  overflow: hidden;
}
.ad-import-row {
  display: grid;
  grid-template-columns: 1fr 180px 70px 110px 80px;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--gg-border);
}
.ad-import-row:last-child { border-bottom: none; }
.ad-import-row--head {
  background: var(--gg-surface-2);
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--gg-ink-soft, #666);
}
.ad-import-row.is-removed { opacity: 0.4; }
.ad-import-row.is-dup { background: rgba(255, 200, 0, 0.08); }

.ad-import-cell--title { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ad-import-cell--title .ad-input { flex: 1; min-width: 0; }
.ad-import-cell--count { text-align: right; }

.ad-input--inline {
  padding: 4px 8px;
  font-size: 0.88rem;
}

/* 进度条 */
.ad-progress {
  margin-top: 12px;
  height: 6px;
  background: var(--gg-surface-2);
  border-radius: 3px;
  overflow: hidden;
}
.ad-progress__bar {
  height: 100%;
  background: var(--gg-ink);
  transition: width 0.3s;
}

.ad-badge.is-ok { background: #2d8c2d; color: #fff; }
.ad-badge.is-error { background: #c0392b; color: #fff; }

.ad-pick-row { display: flex; align-items: center; gap: 8px; }
.ad-pick-row .ad-input { flex: 1; min-width: 0; }
.ad-pick-row .ad-btn { flex: none; }

.ad-tag-groups { display: grid; gap: 12px; }
.ad-tag-group {
  border: 1px solid var(--gg-border);
  border-radius: 10px;
  padding: 10px 14px;
  background: var(--gg-surface-2);
}
.ad-tag-group__title { font-size: 0.88rem; font-weight: 600; color: var(--gg-ink); margin-bottom: 8px; }
.ad-tag-group .ad-chips { margin: 0; }

.ad-style-panel {
  display: grid;
  gap: 14px;
  margin-top: 16px;
  padding: 14px 16px;
  border: 1px solid var(--gg-border);
  border-left: 3px solid var(--gg-ink);
  border-radius: 10px;
  background: var(--gg-surface-2);
}
.ad-style-panel .ad-input { background: var(--gg-surface); }
</style>
