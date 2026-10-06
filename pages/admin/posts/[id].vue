<script setup lang="ts">
import { marked } from 'marked'
import { sessionCachedData } from '~/composables/useSiteData'
import type { TagRef } from '~/composables/useSiteData'

definePageMeta({ layout: 'admin' })

const route = useRoute()
const idParam = String(route.params.id)
const isNew = idParam === 'new'

useHead({ title: `${isNew ? '写新文章' : '编辑文章'} — GarfieldGod 后台` })

// 页面 / 标签候选不 await：它是表单的候选项，不阻塞编辑区渲染
const { data: pagesData } = useFetch<{ pages: AdminNavPage[]; tags: TagRef[] }>(
  '/api/admin/nav-pages',
  { key: 'admin-nav-pages', getCachedData: sessionCachedData },
)

// 详情保留 await：命中 hover 预热 / 会话缓存时同步返回（秒开），未命中则照旧等一次；
// 保留 await 也维持了原来的 404 语义与「表单在 setup 期初始化」的写法
const { data: postData } = await useAsyncData(
  `admin-post:${idParam}`,
  async () => {
    if (isNew) return { post: null as AdminPost | null }
    try {
      return await $fetch<{ post: AdminPost | null }>(`/api/admin/posts/${idParam}`)
    } catch (e) {
      throw createError({ statusCode: 404, message: adminError(e, '文章不存在'), fatal: true })
    }
  },
  { getCachedData: sessionCachedData },
)

// 展示页面候选：只有「内容来源 = 本页文章」的页面会直接收录文章。
// 其余页面（聚合 / 最新 / 静态）不列出自己，但仍要作为层级节点穿过——
// 否则挂在它们下面的子页面会整棵丢失（如「作品」下的四个分类页）。
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

const selectablePageIds = computed(() => new Set(pageOptions.value.map((o) => o.id)))

const source = postData.value?.post ?? null

const form = reactive({
  title: source?.title ?? '',
  date: toLocalInput(source?.date ?? ''),
  content: source?.content ?? '',
  excerpt: source?.excerpt ?? '',
  featured: source?.featured ?? '',
  // 丢掉不在候选列表里的归属（如按最新文章取数的「动态」）：它在界面上不可见，也就取消不掉
  pageIds: (source?.pages ?? [])
    .map((p) => p.id)
    .filter((id) => selectablePageIds.value.has(id)),
  tagIds: (source?.tags ?? []).map((t) => t.id),
  status: source?.status ?? 'published',
  format: source?.format ?? 'markdown',
  contentWidth: source?.contentWidth ?? '',
  postStyle: source?.postStyle ?? '',
  postStyleOptions: resolvePostStyleOptions(source?.postStyleOptions),
  // 是否允许留言：默认允许，关掉后前台整块留言面板都不出现
  allowComments: source?.allowComments ?? true,
})

const pageTitle = computed(() => {
  const map = new Map<number, string>()
  for (const p of pagesData.value?.pages ?? []) map.set(p.id, p.title)
  return map
})

// 标签由页面持有，按归属页面分组
const tagsByPage = computed(() => {
  const map = new Map<number, TagRef[]>()
  for (const t of pagesData.value?.tags ?? []) {
    const arr = map.get(t.pageId) ?? []
    arr.push(t)
    map.set(t.pageId, arr)
  }
  return map
})

// 取消勾选页面时，它持有的标签勾选也要一并撤销：服务端会校验标签归属
watch(
  () => [...form.pageIds],
  () => {
    const allowed = new Set<number>()
    for (const id of form.pageIds) for (const t of tagsByPage.value.get(id) ?? []) allowed.add(t.id)
    form.tagIds = form.tagIds.filter((id) => allowed.has(id))
  },
)

const baseline = ref(JSON.stringify(form))
const dirty = computed(() => JSON.stringify(form) !== baseline.value)

const saving = ref(false)
const uploading = ref(false)
const message = ref('')
const failed = ref(false)
const textarea = ref<HTMLTextAreaElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

// 新文章还没有 ID，上传先落到 posts/_tmp/<group>，保存时由服务端认领为 posts/<id>
const mediaGroup = ref(`p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`)
// 从媒体库选图时，记录这次选择要填到哪个位置
const picker = ref<null | 'content' | 'featured' | 'hero'>(null)

const STATUS_LABELS: Record<string, string> = { published: '已发布', draft: '草稿' }
const FORMAT_LABELS: Record<string, string> = { markdown: 'Markdown', html: 'HTML（老文章）' }
// 正文宽度挡位：空串是「默认」，跟随模板宽度，因此老文章外观不变
const CONTENT_WIDTH_LABELS: Record<string, string> = {
  '': '默认',
  wide: '宽幅',
  normal: '正常',
  narrow: '窄幅',
}

// 各方案自带的设置；「默认 / 经典单栏」沿用现有版式，没有额外设置
const TOC_SIDE_LABELS: Record<string, string> = { right: '右侧', left: '左侧' }
const HERO_SIZE_LABELS: Record<string, string> = { compact: '紧凑', standard: '标准', tall: '加高', none: '无大图' }
// 出现「设置面板」的方案：选中它们时才展开对应的设置组
const STYLES_WITH_SETTINGS = ['toc', 'magazine', 'cards', 'link']
const styleHasSettings = computed(() => STYLES_WITH_SETTINGS.includes(form.postStyle))
// 正文宽度挡位只作用于「默认 / 经典单栏」；其余方案的行宽由版式自己决定
const widthSettingVisible = computed(() => form.postStyle === '' || form.postStyle === 'classic')

const previewHtml = computed(() =>
  form.format === 'markdown' ? (marked.parse(form.content, { async: false }) as string) : form.content,
)

// ===== 右栏实时预览 =====
// 文章只感知自己的详情页形态，所以预览直接复刻 /post/[id] 的文章卡片。
const previewPath = computed(() => (isNew ? '保存后生成访问地址' : `/post/${idParam}`))
const previewPageLabels = computed(() =>
  form.pageIds.map((id) => pageTitle.value.get(id) ?? `页面 #${id}`),
)

function toggleTag(id: number) {
  const i = form.tagIds.indexOf(id)
  if (i === -1) form.tagIds.push(id)
  else form.tagIds.splice(i, 1)
}

function insertAtCursor(text: string) {
  const el = textarea.value
  if (!el) {
    form.content += `\n${text}\n`
    return
  }
  const start = el.selectionStart ?? form.content.length
  const end = el.selectionEnd ?? start
  form.content = `${form.content.slice(0, start)}${text}${form.content.slice(end)}`
  nextTick(() => {
    el.focus()
    el.selectionStart = el.selectionEnd = start + text.length
  })
}

async function uploadImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  uploading.value = true
  message.value = ''
  try {
    const body = new FormData()
    body.append('file', file)
    // 上传进文章私有目录：封面与正文插图都随文章删除，不出现在媒体库
    const scope = isNew ? `group=${mediaGroup.value}` : `postId=${idParam}`
    const res = await $fetch<{ file: MediaItem }>(`/api/admin/media?scope=post&${scope}`, {
      method: 'POST',
      body,
    })
    insertAtCursor(`![${res.file.name}](${res.file.url})`)
    message.value = '图片已插入正文。'
    failed.value = false
  } catch (e) {
    message.value = adminError(e, '上传失败')
    failed.value = true
  } finally {
    uploading.value = false
    input.value = ''
  }
}

// 媒体库选图：同一套弹窗，按调用位置决定填到正文、封面还是头图
function onPickFromLibrary(url: string) {
  const target = picker.value
  picker.value = null
  if (target === 'content') insertAtCursor(`![](${url})`)
  else if (target === 'featured') form.featured = url
  else if (target === 'hero') form.postStyleOptions.heroImage = url
}

async function save() {
  saving.value = true
  message.value = ''
  try {
    const body = {
      title: form.title,
      date: new Date(form.date).toISOString(),
      content: form.content,
      excerpt: form.excerpt,
      featured: form.featured.trim() || null,
      pageIds: form.pageIds,
      tagIds: form.tagIds,
      status: form.status,
      format: form.format,
      contentWidth: form.contentWidth,
      postStyle: form.postStyle,
      postStyleOptions: form.postStyleOptions,
      allowComments: form.allowComments,
    }

    if (isNew) {
      const res = await $fetch<{ post: AdminPost }>('/api/admin/posts', {
        method: 'POST',
        body: { ...body, mediaGroup: mediaGroup.value },
      })
      await refreshNuxtData('admin-posts')
      await navigateTo(`/admin/posts/${res.post.id}`)
      return
    }

    await $fetch(`/api/admin/posts/${idParam}`, { method: 'PUT', body })
    // 列表与详情两个缓存槽都要刷新：否则返回列表 / 再次打开本页时会命中旧缓存
    await Promise.all([
      refreshNuxtData('admin-posts'),
      refreshNuxtData(`admin-post:${idParam}`),
    ])
    baseline.value = JSON.stringify(form)
    failed.value = false
    message.value = '已保存。'
  } catch (e) {
    failed.value = true
    message.value = adminError(e, '保存失败')
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (isNew) return
  saving.value = true
  try {
    // 先问服务端这篇文章自己有多少图片：删除只会动这些，媒体库不受影响
    const { preview } = await $fetch<{ preview: { count: number; bytes: number } }>(
      `/api/admin/posts/${idParam}?preview=1`,
      { method: 'DELETE' },
    )
    const extra = preview.count
      ? `\n\n文章自己的 ${preview.count} 个图片文件（${formatSize(preview.bytes)}）会一并移入回收站，30 天内可恢复。媒体库的图片不受影响。`
      : '\n\n这篇文章没有自己的图片文件。媒体库的图片不受影响。'
    if (!confirm(`确定删除这篇文章？评论与阅读数会一并删除，且不可恢复。${extra}`)) {
      saving.value = false
      return
    }

    await $fetch(`/api/admin/posts/${idParam}`, { method: 'DELETE' })
    await refreshNuxtData('admin-posts')
    await navigateTo('/admin/posts')
  } catch (e) {
    failed.value = true
    message.value = adminError(e, '删除失败')
    saving.value = false
  }
}
</script>

<template>
  <div>
    <div class="ad-head">
      <div>
        <h1 class="ad-title">{{ isNew ? '写新文章' : '编辑文章' }}</h1>
        <p class="ad-sub">
          <template v-if="!isNew">
            <NuxtLink to="/admin/posts">文章</NuxtLink> / #{{ idParam }}
            <span v-if="dirty" class="ad-badge is-draft" style="margin-left: 8px">有未保存的修改</span>
          </template>
        </p>
      </div>
      <div class="ad-actions">
        <a v-if="!isNew" class="ad-btn" :href="`/post/${idParam}`" target="_blank" rel="noopener">打开页面</a>
        <button v-if="!isNew" class="ad-btn ad-btn--danger" type="button" :disabled="saving" @click="remove">删除</button>
        <button class="ad-btn ad-btn--primary" type="button" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </div>
    </div>

    <p v-if="message" class="ad-msg" :class="failed ? 'is-error' : 'is-ok'">{{ message }}</p>

    <div class="ad-work">
      <div class="ad-work__col">
        <!-- 基本信息：标题、时间、状态、正文格式 -->
        <section class="ad-card">
          <div class="ad-card__head">
            <h2 class="ad-card__title">基本信息</h2>
            <span class="ad-hint">{{ previewPath }}</span>
          </div>

          <div class="ad-form">
            <label class="ad-f c6">
              <span>标题 <em>*</em></span>
              <input v-model="form.title" class="ad-input" type="text" maxlength="200" placeholder="文章标题" />
            </label>

            <label class="ad-f c3">
              <span>发布时间</span>
              <input v-model="form.date" class="ad-input" type="datetime-local" />
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
                  @click="form.status = key"
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
                  @click="form.format = key"
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

        <!-- 展示页面：这篇文章会出现在哪些页面 -->
        <section class="ad-card">
          <div class="ad-card__head">
            <h2 class="ad-card__title">展示页面</h2>
          </div>
          <p class="ad-hint" style="margin: 0 0 12px">
            仅「内容来源 = 本页文章」的页面在此处显示。
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

        <!-- 标签：按归属页面分组 -->
        <section class="ad-card">
          <div class="ad-card__head">
            <h2 class="ad-card__title">标签</h2>
          </div>
          <p class="ad-hint" style="margin: 0 0 12px">
            标签由展示页面持有。
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
              <p v-else class="ad-hint">该页面暂无标签，可在「页面」编辑中为它添加。</p>
            </div>
          </div>
        </section>

        <!-- 封面与摘要 -->
        <section class="ad-card">
          <div class="ad-card__head">
            <h2 class="ad-card__title">封面与摘要</h2>
          </div>
          <div class="ad-form">
            <div class="ad-f c6">
              <span>封面图地址</span>
              <div class="ad-pick-row">
                <input v-model="form.featured" class="ad-input" type="text" placeholder="/media/xxx.jpg 或 /uploads/..." />
                <button class="ad-btn ad-btn--sm" type="button" @click="picker = 'featured'">从媒体库选择</button>
              </div>
            </div>
            <label class="ad-f c6">
              <span>摘要（留空自动从正文截取）</span>
              <input v-model="form.excerpt" class="ad-input" type="text" maxlength="200" />
            </label>
          </div>
        </section>

        <!-- 文章样式：选定方案后只展开该方案自己的设置 -->
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
                @click="form.postStyle = key"
              >
                {{ label }}
              </button>
            </div>
          </div>

          <!-- 设置面板：只有带附加设置的方案才出现 -->
          <div v-if="styleHasSettings" class="ad-style-panel">
            <!-- 左文右栏：目录栏位置 + 阅读进度 -->
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
                <p class="ad-hint" style="margin: 0">窄屏下目录栏会自动折到正文下方，两栏变一行。</p>
              </div>
              <div class="ad-checks">
                <label class="ad-check">
                  <input v-model="form.postStyleOptions.tocProgress" type="checkbox" />
                  显示阅读进度
                </label>
              </div>
            </template>

            <!-- 杂志大图：头图挡位 + 头图地址 + 内容卡片开关 -->
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
              <div v-if="form.postStyleOptions.heroSize !== 'none'" class="ad-f c6">
                <span>头图地址</span>
                <div class="ad-pick-row">
                  <input
                    v-model="form.postStyleOptions.heroImage"
                    class="ad-input"
                    type="text"
                    placeholder="/media/xxx.jpg 或 /uploads/...（留空用灰阶渐变占位）"
                  />
                  <button class="ad-btn ad-btn--sm" type="button" @click="picker = 'hero'">从媒体库选择</button>
                </div>
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
              </div>
            </template>

            <!-- 分节卡片：迷你导航 + 小节编号 -->
            <template v-else-if="form.postStyle === 'cards'">
              <div class="ad-checks">
                <label class="ad-check">
                  <input v-model="form.postStyleOptions.miniNav" type="checkbox" />
                  顶部迷你导航（吸顶的小节快捷跳转）
                </label>
                <label class="ad-check">
                  <input v-model="form.postStyleOptions.sectionNumbers" type="checkbox" />
                  显示「第 N 节」小节编号
                </label>
              </div>
            </template>
            <!-- 超链接：跳转地址 + 自动跳转等待秒数 -->
            <template v-else-if="form.postStyle === 'link'">
              <label class="ad-f c6">
                <span>跳转地址</span>
                <input
                  v-model="form.postStyleOptions.linkUrl"
                  class="ad-input"
                  type="text"
                  placeholder="https://example.com/article"
                />
              </label>
              <div class="ad-f c3">
                <span>自动跳转等待</span>
                <AdminStepper v-model="form.postStyleOptions.linkDelay" :min="0" :max="30" />
                <p class="ad-hint" style="margin: 0">
                   0 表示不自动跳转。
                </p>
              </div>
            </template>
          </div>
          <p v-else class="ad-hint" style="margin: 12px 0 0">
            该方案使用默认设置，没有额外的可调项。
          </p>
        </section>

        <!-- 正文：Markdown 源码（渲染效果见右栏「效果预览」） -->
        <section class="ad-card">
          <div class="ad-card__head">
            <h2 class="ad-card__title">正文</h2>
            <div class="ad-editor__toolbar">
              <span class="ad-hint">{{ form.format === 'markdown' ? 'Markdown 模式' : 'HTML 源码模式' }}</span>
              <button class="ad-btn ad-btn--sm" type="button" :disabled="uploading" @click="fileInput?.click()">
                {{ uploading ? '上传中…' : '上传图片' }}
              </button>
              <button class="ad-btn ad-btn--sm" type="button" @click="picker = 'content'">从媒体库选择</button>
              <input ref="fileInput" type="file" accept="image/*,video/mp4,video/webm,audio/mpeg" hidden @change="uploadImage" />
            </div>
          </div>

          <div v-if="widthSettingVisible" class="ad-f c6" style="margin-bottom: 16px">
            <span>正文宽度</span>
            <div class="ad-seg ad-seg--block" style="max-width: 480px">
              <button
                v-for="(label, key) in CONTENT_WIDTH_LABELS"
                :key="key || 'default'"
                type="button"
                class="ad-seg__btn"
                :class="{ 'is-on': form.contentWidth === key }"
                @click="form.contentWidth = key"
              >
                {{ label }}
              </button>
            </div>
            <p class="ad-hint" style="margin: 0">
              「默认」跟随模板宽度（650px）；「宽幅」放宽到与分隔线同宽，「正常」略宽于默认，「窄幅」收窄，正文与底部元信息一起变化。
            </p>
          </div>
          <p v-else class="ad-hint" style="margin: 0 0 16px">
            当前方案的正文行宽由版式自身决定（目录栏 / 杂志大图 / 分节卡片 / 超链接），「正文宽度」不再参与。
          </p>

          <!-- 单栏源码编辑：渲染效果统一看右栏「效果预览」，不再内嵌第二个预览框 -->
          <div class="ad-editor">
            <div class="ad-editor__pane">
              <textarea ref="textarea" v-model="form.content" class="ad-textarea ad-editor__code" spellcheck="false" />
            </div>
          </div>
        </section>
      </div>

      <!-- 右栏：效果预览（文章详情页缩略示意，随滚动吸顶） -->
      <aside class="ad-preview-panel">
        <div class="ad-preview-panel__bar">
          <strong>效果预览</strong>
          <span>{{ form.title || '未命名文章' }} · {{ previewPath }}</span>
        </div>
        <div class="ad-preview-panel__body">
          <PostPreview
            :title="form.title"
            :content-html="previewHtml"
            :date="form.date"
            :page-labels="previewPageLabels"
            :is-draft="form.status === 'draft'"
            :content-width="form.contentWidth"
            :post-style="form.postStyle"
            :post-style-options="form.postStyleOptions"
          />
        </div>
        <div class="ad-preview-panel__foot">
          预览为文章详情页的缩略示意；保存后前台即为该效果。
        </div>
      </aside>
    </div>

    <!-- 媒体库选图弹窗：正文 / 封面 / 头图共用，填到哪由 picker 决定 -->
    <MediaPicker v-if="picker" @select="onPickFromLibrary" @close="picker = null" />
  </div>
</template>

<style scoped>
/* 地址输入 + 「从媒体库选择」：输入框吃掉剩余宽度，按钮不换行 */
.ad-pick-row { display: flex; align-items: center; gap: 8px; }
.ad-pick-row .ad-input { flex: 1; min-width: 0; }
.ad-pick-row .ad-btn { flex: none; }

/* 标签按展示页面分组：每组一个浅色小标题，与页面勾选顺序一致 */
.ad-tag-groups { display: grid; gap: 12px; }
.ad-tag-group {
  border: 1px solid var(--gg-border);
  border-radius: 10px;
  padding: 10px 14px;
  background: var(--gg-surface-2);
}
.ad-tag-group__title { font-size: 0.88rem; font-weight: 600; color: var(--gg-ink); margin-bottom: 8px; }
.ad-tag-group .ad-chips { margin: 0; }

/* 样式方案的设置面板：与「样式方案」选择器拉开距离，视觉上归属同一个方案 */
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
