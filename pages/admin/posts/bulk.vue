<script setup lang="ts">
import { marked } from 'marked'
import { resolvePostStyleOptions, sessionCachedData } from '~/composables/useSiteData'
import type { PostStyleOptions } from '~/composables/useSiteData'

definePageMeta({ layout: 'admin' })
useHead({ title: '批量编辑 — GarfieldGod 后台' })

const route = useRoute()

// 从列表页带过来的勾选 id（保持顺序）
const ids = computed(() => {
  const raw = route.query.ids
  const str = Array.isArray(raw) ? raw.join(',') : String(raw ?? '')
  return str
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
})

const { data: postsData } = useFetch<{ posts: AdminPost[] }>('/api/admin/posts', {
  key: 'admin-posts',
  getCachedData: sessionCachedData,
})

const posts = computed(() => {
  const map = new Map((postsData.value?.posts ?? []).map((p) => [p.id, p]))
  return ids.value.map((id) => map.get(id)).filter((p): p is AdminPost => !!p)
})

// 可从本次操作中剔除某篇（不影响文章本身）
const removedIds = ref<number[]>([])
const activePosts = computed(() => posts.value.filter((p) => !removedIds.value.includes(p.id)))

// ===== 可改的两项，都带「不修改」态 =====
const KEEP = 'keep'
const form = reactive({
  comments: KEEP as 'keep' | 'allow' | 'deny',
  postStyle: KEEP as string,
  postStyleOptions: resolvePostStyleOptions({ tocSide: 'right', tocProgress: true }),
})

const BULK_STYLES = Object.entries(POST_STYLE_LABELS)
  .filter(([key]) => key !== 'link')
  .map(([key, label]) => ({ key, label }))

const TOC_SIDE_LABELS: Record<string, string> = { right: '右侧', left: '左侧' }
const HERO_SIZE_LABELS: Record<string, string> = { compact: '紧凑', standard: '标准', tall: '加高', none: '无大图' }

const styleHasSettings = computed(() => ['toc', 'magazine', 'cards'].includes(form.postStyle))
const dirty = computed(() => form.comments !== KEEP || form.postStyle !== KEEP)

// 只回传用户在面板上能调的旋钮，其余选项（如杂志头图）沿用每篇自己的值
function styleOptionPatch(): Partial<PostStyleOptions> {
  switch (form.postStyle) {
    case 'toc':
      return { tocSide: form.postStyleOptions.tocSide, tocProgress: form.postStyleOptions.tocProgress }
    case 'magazine':
      return {
        heroSize: form.postStyleOptions.heroSize,
        showByline: form.postStyleOptions.showByline,
        dropCap: form.postStyleOptions.dropCap,
        showLabel: form.postStyleOptions.showLabel,
        showLede: form.postStyleOptions.showLede,
        centerTitle: form.postStyleOptions.centerTitle,
        fullWidthMedia: form.postStyleOptions.fullWidthMedia,
      }
    case 'cards':
      return { miniNav: form.postStyleOptions.miniNav, sectionNumbers: form.postStyleOptions.sectionNumbers }
    default:
      return {}
  }
}

// 后台的 PUT 是「整篇覆盖」：完整字段回传，只覆盖用户改的那两项，其余原样
function buildPayload(p: AdminPost): PostPayload {
  const payload: PostPayload = {
    title: p.title,
    date: p.date,
    content: p.content,
    excerpt: p.excerpt,
    featured: p.featured,
    pageIds: p.pages.map((x) => x.id),
    tagIds: p.tags.map((x) => x.id),
    status: p.status,
    format: p.format,
    contentWidth: p.contentWidth,
    postStyle: p.postStyle,
    postStyleOptions: p.postStyleOptions,
    allowComments: p.allowComments,
  }
  if (form.comments !== KEEP) payload.allowComments = form.comments === 'allow'
  if (form.postStyle !== KEEP) {
    payload.postStyle = form.postStyle
    payload.postStyleOptions = { ...resolvePostStyleOptions(p.postStyleOptions), ...styleOptionPatch() }
  }
  return payload
}

// ===== 执行：限 3 并发，逐篇 PUT =====
const applying = ref(false)
const progress = ref(0)
const okCount = ref(0)
const failCount = ref(0)
const message = ref('')

async function apply() {
  const targets = activePosts.value
  if (!targets.length || !dirty.value) return
  applying.value = true
  progress.value = 0
  okCount.value = 0
  failCount.value = 0
  message.value = ''

  const CONCURRENCY = 3
  let cursor = 0
  const worker = async () => {
    while (cursor < targets.length) {
      const p = targets[cursor++]
      try {
        await $fetch(`/api/admin/posts/${p.id}`, { method: 'PUT', body: buildPayload(p) })
        okCount.value++
      } catch {
        failCount.value++
      }
      progress.value = Math.round(((okCount.value + failCount.value) / targets.length) * 100)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

  applying.value = false
  await refreshNuxtData('admin-posts')
  message.value = `完成：成功 ${okCount.value} 篇${failCount.value ? `，失败 ${failCount.value} 篇` : ''}。`
}

// 导入中拦截路由离开
const beforeUnload = (e: BeforeUnloadEvent) => {
  if (applying.value) {
    e.preventDefault()
    e.returnValue = ''
  }
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))

// ===== 预览 =====
const SAMPLE_CONTENT = `# 示例文章标题

这是一段引言正文，用来预览版式的整体观感。切到不同的文章样式，右栏会即时呈现对应的版式效果。

## 第一节 起手

这里是一段普通的正文。左文右栏方案会在右侧抽出目录，分节卡片方案会按二级标题切分。

- 列表项一
- 列表项二
- 列表项三

## 第二节 推进

第二段正文，用来观察段落间距、目录高亮等细节。

### 子小节

三级标题也会进入目录，但层级比二级标题低一档。

## 第三节 收束

最后一段正文，验证阅读进度条、迷你导航等收尾元素。`

const previewHtml = computed(() => marked.parse(SAMPLE_CONTENT, { async: false }) as string)
// 未选择新样式时，用第一篇的现有样式预览，便于对照
const previewStyle = computed(() =>
  form.postStyle !== KEEP ? form.postStyle : (activePosts.value[0]?.postStyle ?? ''),
)
const previewOptions = computed(() =>
  form.postStyle !== KEEP
    ? form.postStyleOptions
    : resolvePostStyleOptions(activePosts.value[0]?.postStyleOptions),
)
</script>

<template>
  <div>
    <div class="ad-head">
      <div>
        <h1 class="ad-title">批量编辑</h1>
        <p class="ad-sub">
          <NuxtLink to="/admin/posts">文章</NuxtLink> / 批量编辑
        </p>
      </div>
      <div class="ad-actions">
        <NuxtLink class="ad-btn" to="/admin/posts">返回文章列表</NuxtLink>
        <button
          class="ad-btn ad-btn--primary"
          type="button"
          :disabled="applying || !dirty || !activePosts.length"
          @click="apply"
        >
          {{
            applying
              ? `应用中 ${progress}%`
              : `应用修改${activePosts.length ? `（${activePosts.length} 篇）` : ''}`
          }}
        </button>
      </div>
    </div>

    <p class="ad-hint" style="margin: 0 0 16px">
      批量编辑只改「是否留言」和「文章样式」两项，其余字段原样保留。两项都设为「不修改」时不会提交。
    </p>

    <p v-if="message" class="ad-msg" :class="message.includes('失败') ? 'is-error' : 'is-ok'">
      {{ message }}
    </p>

    <div class="ad-work">
      <div class="ad-work__col">
        <!-- 设置：两个控件，各带「不修改」 -->
        <section class="ad-card">
          <div class="ad-card__head">
            <h2 class="ad-card__title">设置</h2>
          </div>
          <div class="ad-form">
            <div class="ad-f c6">
              <span>留言</span>
              <div class="ad-seg ad-seg--block" style="max-width: 400px">
                <button
                  class="ad-seg__btn"
                  :class="{ 'is-on': form.comments === 'keep' }"
                  type="button"
                  @click="form.comments = 'keep'"
                >
                  不修改
                </button>
                <button
                  class="ad-seg__btn"
                  :class="{ 'is-on': form.comments === 'allow' }"
                  type="button"
                  @click="form.comments = 'allow'"
                >
                  允许留言
                </button>
                <button
                  class="ad-seg__btn"
                  :class="{ 'is-on': form.comments === 'deny' }"
                  type="button"
                  @click="form.comments = 'deny'"
                >
                  不接受留言
                </button>
              </div>
            </div>
            <div class="ad-f c6">
              <span>文章样式</span>
              <div class="ad-seg ad-seg--block" style="max-width: 640px">
                <button
                  class="ad-seg__btn"
                  :class="{ 'is-on': form.postStyle === KEEP }"
                  type="button"
                  @click="form.postStyle = KEEP"
                >
                  不修改
                </button>
                <button
                  v-for="s in BULK_STYLES"
                  :key="s.key || 'default'"
                  class="ad-seg__btn"
                  :class="{ 'is-on': form.postStyle === s.key }"
                  type="button"
                  @click="form.postStyle = s.key"
                >
                  {{ s.label }}
                </button>
              </div>
              <p class="ad-hint" style="margin: 6px 0 0">
                超链接方案需要逐篇填跳转地址，不在批量范围内。
              </p>
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
                    class="ad-seg__btn"
                    :class="{ 'is-on': form.postStyleOptions.tocSide === key }"
                    type="button"
                    @click="form.postStyleOptions.tocSide = key as 'right' | 'left'"
                  >
                    {{ label }}
                  </button>
                </div>
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
                    class="ad-seg__btn"
                    :class="{ 'is-on': form.postStyleOptions.heroSize === key }"
                    type="button"
                    @click="form.postStyleOptions.heroSize = key as 'compact' | 'standard' | 'tall' | 'none'"
                  >
                    {{ label }}
                  </button>
                </div>
                <p class="ad-hint" style="margin: 0">选「无大图」时不显示封面带，标题区改由白卡顶端承载。</p>
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
              <p class="ad-hint" style="margin: 0">头图沿用各篇文章自己的设置，批量不改图。</p>
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
          </div>
        </section>

        <!-- 文章列表 -->
        <section class="ad-card">
          <div class="ad-card__head">
            <h2 class="ad-card__title">文章列表</h2>
            <span class="ad-hint">{{ activePosts.length }} / {{ posts.length }} 篇</span>
          </div>
          <div v-if="posts.length" class="ad-bulk-list">
            <div class="ad-bulk-row ad-bulk-row--head">
              <span>标题</span>
              <span>当前样式</span>
              <span>当前留言</span>
              <span></span>
            </div>
            <div
              v-for="p in posts"
              :key="p.id"
              class="ad-bulk-row"
              :class="{ 'is-removed': removedIds.includes(p.id) }"
            >
              <span class="ad-bulk-cell--title">
                <NuxtLink class="ad-table__title" :to="`/admin/posts/${p.id}`">{{ p.title }}</NuxtLink>
              </span>
              <span class="ad-hint">{{ POST_STYLE_LABELS[p.postStyle] ?? '默认' }}</span>
              <span class="ad-hint">{{ p.allowComments ? '允许' : '关闭' }}</span>
              <span>
                <button
                  v-if="!removedIds.includes(p.id)"
                  class="ad-btn ad-btn--sm"
                  type="button"
                  :disabled="applying"
                  @click="removedIds.push(p.id)"
                >
                  移除
                </button>
                <button
                  v-else
                  class="ad-btn ad-btn--sm"
                  type="button"
                  @click="removedIds = removedIds.filter((x) => x !== p.id)"
                >
                  恢复
                </button>
              </span>
            </div>
          </div>
          <p v-else class="ad-empty">没有找到要编辑的文章，请回到文章列表重新勾选。</p>

          <div v-if="applying" class="ad-progress">
            <div class="ad-progress__bar" :style="{ width: `${progress}%` }" />
          </div>
        </section>
      </div>

      <!-- 右栏：效果预览 -->
      <aside class="ad-preview-panel">
        <div class="ad-preview-panel__bar">
          <strong>效果预览</strong>
          <span>示例正文 · {{ form.postStyle === KEEP ? '未修改' : (POST_STYLE_LABELS[form.postStyle] ?? '默认') }}</span>
        </div>
        <div class="ad-preview-panel__body">
          <PostPreview
            title="示例文章标题"
            :content-html="previewHtml"
            date=""
            :page-labels="[]"
            :is-draft="false"
            content-width=""
            :post-style="previewStyle"
            :post-style-options="previewOptions"
          />
        </div>
        <div class="ad-preview-panel__foot">
          预览用固定示例正文；实际效果以各篇文章保存后的编辑页为准。
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
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

.ad-bulk-list {
  border: 1px solid var(--gg-border);
  border-radius: 10px;
  overflow: hidden;
}
.ad-bulk-row {
  display: grid;
  grid-template-columns: 1fr 110px 90px 80px;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--gg-border);
}
.ad-bulk-row:last-child {
  border-bottom: none;
}
.ad-bulk-row--head {
  background: var(--gg-surface-2);
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--gg-ink-soft, #666);
}
.ad-bulk-row.is-removed {
  opacity: 0.4;
}
.ad-bulk-cell--title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

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
</style>