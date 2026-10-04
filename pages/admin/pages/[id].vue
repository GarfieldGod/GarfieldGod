<script setup lang="ts">
import { marked } from 'marked'
import {
  supportsAspectRatio,
  supportsDatePosition,
  type AspectRatio,
  type CardType,
  type ContentSource,
  type DatePosition,
  type NavPage,
  type NavPageDetail,
  type PageLayout,
} from '~/composables/useSiteData'

definePageMeta({ layout: 'admin' })

const route = useRoute()
const idParam = String(route.params.id)
const isNew = idParam === 'new'

useHead({ title: `${isNew ? '新建页面' : '编辑页面'} — GarfieldGod 后台` })

const { data: listData } = await useFetch<{ pages: AdminNavPage[] }>('/api/admin/nav-pages', {
  key: 'admin-nav-pages',
})

const { data: detail } = await useAsyncData(`admin-nav-page:${idParam}`, async () => {
  // 新建时也返回同形状的空对象：useAsyncData 在 SSR 下返回 null 会触发 Nuxt 警告
  if (isNew) return { page: null as AdminNavPage | null }
  try {
    return await $fetch<{ page: AdminNavPage }>(`/api/admin/nav-pages/${idParam}`)
  } catch (e) {
    throw createError({ statusCode: 404, message: adminError(e, '页面不存在'), fatal: true })
  }
})

const source = detail.value?.page ?? null
const allPages = computed(() => listData.value?.pages ?? [])

// 首页由 pages/index.vue 独立渲染「最新事项」分节，不吃「展示类型」，
// 该项在首页置空、置灰；「条目类型」与「每行列数」对首页同样生效
const isHomePage = computed(() => !!source?.isHome)

const form = reactive({
  slug: source?.slug ?? '',
  title: source?.title ?? '',
  parentId: source?.parentId ?? 0,
  sortOrder: source?.sortOrder ?? 0,
  navVisible: source?.navVisible ?? true,
  layout: source?.layout ?? 'items',
  cardType: source?.cardType ?? 'standard',
  // 条目类型决定列数上限：历史数据若超出上限就按上限收敛，避免出现「没有任何可选项」的死状态
  columns: Math.max(1, Math.min(source?.columns ?? 1, cardMaxColumns(source?.cardType ?? 'standard'))),
  pageSize: source?.pageSize ?? 10,
  itemFields: {
    ...(source?.itemFields ?? ITEM_FIELD_DEFAULTS[source?.cardType ?? 'standard'] ?? {}),
  } as Record<string, boolean>,
  datePosition: (source?.datePosition ?? 'inline') as DatePosition,
  aspectRatio: (source?.aspectRatio ?? '') as AspectRatio,
  contentSource: source?.contentSource ?? 'posts',
  aggregatePages: [...(source?.aggregatePages ?? [])],
  latestLimit: source?.latestLimit ?? 10,
  showCover: source?.showCover ?? false,
  coverImage: source?.coverImage ?? '',
  tagFilter: source?.tagFilter ?? false,
  // 「子页面」展示类型：总览里是否显示「共 N 篇 / 查看全部」，默认开
  showChildDetail: source?.showChildDetail ?? true,
  content: source?.content ?? '',
  tagsText: (source?.tagNames ?? []).join(', '),
})

const baseline = ref(JSON.stringify(form))
const dirty = computed(() => JSON.stringify(form) !== baseline.value)

const saving = ref(false)
const message = ref('')
const failed = ref(false)

const isItems = computed(() => form.layout === 'items')
const isChildren = computed(() => form.layout === 'children')
const staticBody = computed(() => form.layout === 'static')
// 只有「条目项」会铺条目（首页由独立模板铺「最新事项」，同样吃条目类型与列数）。
// 静态文本渲染正文、子页面竖排子页面总览，都不铺条目，所以条目内容与条目来源对它们不适用。
const showsItems = computed(() => isHomePage.value || isItems.value)
const previewHtml = computed(() => marked.parse(form.content, { async: false }) as string)
const previewPath = computed(() => (source?.isHome ? '/' : `/${form.slug || source?.slug || ''}`))

// ===== 右栏实时预览 =====
// 预览的条目数据来自已保存的页面（服务端解析），而形态（展示类型 / 条目类型 / 列数 /
// 显示字段）直接读表单，改动即时可见；条目来源这类需要重算数据集的配置，保存后生效。
const previewUrl = computed(
  () =>
    `/api/nav-pages/${(source?.slug ?? '').split('/').filter(Boolean).map(encodeURIComponent).join('/')}`,
)
const { data: previewData } = await useFetch<NavPageDetail>(previewUrl, {
  key: `admin-page-preview:${idParam}`,
  immediate: !isNew && !!source?.slug,
})

const previewPage = computed<NavPage>(() => ({
  id: source?.id ?? 0,
  slug: form.slug,
  title: form.title || '未命名页面',
  parentId: form.parentId,
  sortOrder: form.sortOrder,
  navVisible: form.navVisible,
  // 首页固定按「条目项」预览，与前台首页的「最新事项」一致
  layout: (isHomePage.value ? 'items' : form.layout) as PageLayout,
  cardType: form.cardType as CardType,
  columns: form.columns,
  pageSize: form.pageSize,
  itemFields: { ...form.itemFields },
  datePosition: form.datePosition,
  aspectRatio: form.aspectRatio,
  contentSource: form.contentSource as ContentSource,
  aggregatePages: [...form.aggregatePages],
  latestLimit: form.latestLimit,
  showCover: form.showCover,
  coverImage: form.coverImage || null,
  isHome: !!source?.isHome,
  tagFilter: form.tagFilter,
  showChildDetail: form.showChildDetail,
  content: form.content,
  reserved: !!source?.reserved,
}))

const previewPosts = computed(() => previewData.value?.posts ?? [])
const previewTags = computed(() => previewData.value?.tags ?? [])
const previewPageLabels = computed(() => previewData.value?.pageLabels ?? {})

// 子页面清单读页面树（而非已保存的 childSections），这样把展示类型切到「子页面」时也能立即预览
const previewChildPages = computed(() =>
  allPages.value
    .filter((p) => p.parentId === source?.id)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    .map((p) => ({ id: p.id, title: p.title, count: p.postCount })),
)

// 自身与全部后代都不能当父页面，否则页面树成环
const blockedIds = computed(() => {
  const set = new Set<number>()
  if (isNew || !source) return set
  const childrenOf = new Map<number, number[]>()
  for (const p of allPages.value) {
    const list = childrenOf.get(p.parentId) ?? []
    list.push(p.id)
    childrenOf.set(p.parentId, list)
  }
  set.add(source.id)
  const stack = [source.id]
  while (stack.length) {
    for (const child of childrenOf.get(stack.pop()!) ?? []) {
      if (!set.has(child)) {
        set.add(child)
        stack.push(child)
      }
    }
  }
  return set
})

const parentOptions = computed(() => {
  const byParent = new Map<number, AdminNavPage[]>()
  for (const p of allPages.value) {
    const list = byParent.get(p.parentId) ?? []
    list.push(p)
    byParent.set(p.parentId, list)
  }
  for (const list of byParent.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)

  const out: { id: number; label: string }[] = []
  const walk = (parentId: number, depth: number) => {
    for (const page of byParent.get(parentId) ?? []) {
      if (blockedIds.value.has(page.id)) continue
      out.push({ id: page.id, label: `${'　'.repeat(depth)}${page.title}` })
      walk(page.id, depth + 1)
    }
  }
  walk(0, 0)
  return out
})

// 聚合页面候选项：整棵页面树，仅排除自身（自身不可聚合自己）
const aggregateOptions = computed(() => {
  const byParent = new Map<number, AdminNavPage[]>()
  for (const p of allPages.value) {
    const arr = byParent.get(p.parentId) ?? []
    arr.push(p)
    byParent.set(p.parentId, arr)
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)

  const out: { id: number; label: string }[] = []
  const walk = (parentId: number, depth: number) => {
    for (const page of byParent.get(parentId) ?? []) {
      // 仍要向下遍历，否则自身的子页面会整段消失
      if (page.id !== source?.id) {
        out.push({ id: page.id, label: `${'　'.repeat(depth)}${page.title}` })
      }
      walk(page.id, depth + 1)
    }
  }
  walk(0, 0)
  return out
})

// 分段控件 / 缩略卡都通过函数回写，保证写进 form 的是受约束的枚举值
function setLayout(key: string) {
  form.layout = key as PageLayout
}
function setSource(key: string) {
  form.contentSource = key as ContentSource
}
function setCardType(key: string) {
  form.cardType = key as CardType
  // 条目类型决定卡片形态，列数上限随之收紧；超限就收敛，避免存下必然溢出的配置
  const max = cardMaxColumns(key)
  if (form.columns > max) form.columns = max
}
function setDatePosition(key: string) {
  form.datePosition = key as DatePosition
}
function setAspectRatio(key: string) {
  form.aspectRatio = key as AspectRatio
}

// 日期位置只对「全图叠加 / 网格卡」有意义，且要先勾选了「日期」才谈得上摆放
const canSetDatePosition = computed(
  () => supportsDatePosition(form.cardType as CardType) && !!form.itemFields.date,
)

// 宽高比同样只对「全图叠加 / 网格卡」开放
const canSetAspectRatio = computed(() => supportsAspectRatio(form.cardType as CardType))

// 每行列数上限跟着「条目类型」走：列数过多时卡片宽度不够，内容会被截断
const maxColumns = computed(() => cardMaxColumns(form.cardType))

// 字段默认值跟着「条目类型」走（条目类型决定卡片外观，字段只决定显示哪些内容）
function applyFieldDefaults() {
  form.itemFields = { ...(ITEM_FIELD_DEFAULTS[form.cardType] ?? {}) }
}

async function save() {
  saving.value = true
  message.value = ''
  try {
    const body = {
      slug: form.slug,
      title: form.title,
      parentId: form.parentId,
      sortOrder: form.sortOrder,
      navVisible: form.navVisible,
      layout: form.layout,
      cardType: form.cardType,
      columns: form.columns,
      pageSize: form.pageSize,
      itemFields: form.itemFields,
      datePosition: form.datePosition,
      aspectRatio: form.aspectRatio,
      contentSource: form.contentSource,
      aggregatePages: form.aggregatePages,
      latestLimit: form.latestLimit,
      showCover: form.showCover,
      coverImage: form.coverImage.trim(),
      tagFilter: form.tagFilter,
      showChildDetail: form.showChildDetail,
      content: form.content,
      tagNames: form.tagsText
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean),
    }

    if (isNew) {
      const res = await $fetch<{ page: AdminNavPage }>('/api/admin/nav-pages', { method: 'POST', body })
      await refreshNuxtData('admin-nav-pages')
      await navigateTo(`/admin/pages/${res.page.id}`)
      return
    }

    await $fetch(`/api/admin/nav-pages/${idParam}`, { method: 'PUT', body })
    await refreshNuxtData('admin-nav-pages')
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
  if (!confirm(`确定删除页面「${form.title}」？该页面路径将立即失效，且不可恢复。`)) return
  saving.value = true
  try {
    await $fetch(`/api/admin/nav-pages/${idParam}`, { method: 'DELETE' })
    await refreshNuxtData('admin-nav-pages')
    await navigateTo('/admin/pages')
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
        <h1 class="ad-title">{{ isNew ? '新建页面' : '编辑页面' }}</h1>
        <p class="ad-sub">
          <template v-if="!isNew">
            <NuxtLink to="/admin/pages">页面</NuxtLink> / {{ source?.title }}
            <span v-if="dirty" class="ad-badge is-draft" style="margin-left: 8px">有未保存的修改</span>
          </template>
        </p>
      </div>
      <div class="ad-actions">
        <a v-if="!isNew && source" class="ad-btn" :href="previewPath" target="_blank" rel="noopener">打开页面</a>
        <button
          v-if="!isNew && source && !source.reserved && !source.isHome"
          class="ad-btn ad-btn--danger"
          type="button"
          :disabled="saving"
          @click="remove"
        >
          删除
        </button>
        <button class="ad-btn ad-btn--primary" type="button" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </div>
    </div>

    <p v-if="message" class="ad-msg" :class="failed ? 'is-error' : 'is-ok'">{{ message }}</p>

    <div class="ad-work">
      <div class="ad-work__col">
        <!-- 基本信息：标题、路径、层级、导航 -->
        <section class="ad-card">
          <div class="ad-card__head">
            <h2 class="ad-card__title">基本信息</h2>
            <span class="ad-hint">{{ previewPath }}</span>
          </div>

          <div class="ad-form">
            <label class="ad-f c3">
              <span>标题 <em>*</em></span>
              <input v-model="form.title" class="ad-input" type="text" maxlength="100" placeholder="如：学习笔记" />
            </label>
            <label class="ad-f c3">
              <span>页面路径</span>
              <input
                v-model="form.slug"
                class="ad-input"
                type="text"
                :disabled="!!source?.reserved"
                placeholder="如：category/notes"
              />
            </label>
            <label class="ad-f c3">
              <span>父页面</span>
              <select v-model="form.parentId" class="ad-select">
                <option :value="0">顶层（直接显示在导航栏）</option>
                <option v-for="opt in parentOptions" :key="opt.id" :value="opt.id">{{ opt.label }}</option>
              </select>
            </label>
            <div class="ad-f c3">
              <span>排序</span>
              <AdminStepper v-model="form.sortOrder" :min="0" :max="9999" />
            </div>
          </div>
          <p class="ad-hint" style="margin-top: 12px">
            <template v-if="source?.reserved">保留页面的路径不可修改，避免固定入口失效。</template>
            <template v-else>
              <template v-if="source?.isHome">首页实际访问地址为 /。</template>
              <template v-else>当前访问地址为 {{ previewPath }}</template>
            </template>
            <br />
          </p>

          <div class="ad-toggles">
            <button
              type="button"
              class="ad-sw"
              :class="{ 'is-off': !form.navVisible }"
              @click="form.navVisible = !form.navVisible"
            >
              <span class="ad-sw__track" />{{ form.navVisible ? '在导航栏显示' : '不在导航栏显示' }}
            </button>
          </div>
        </section>

        <!-- 内容展示：展示类型、布局参数、页面封面 -->
        <section class="ad-card">
          <div class="ad-card__head">
            <h2 class="ad-card__title">内容展示</h2>
          </div>

          <div class="ad-form">
            <div class="ad-f c6">
              <span>展示类型</span>
              <div class="ad-seg ad-seg--block">
                <button
                  v-for="(label, key) in LAYOUT_LABELS"
                  :key="key"
                  type="button"
                  class="ad-seg__btn"
                  :class="{ 'is-on': (isHomePage ? 'items' : form.layout) === key }"
                  :disabled="isHomePage"
                  @click="setLayout(key)"
                >
                  {{ label }}
                </button>
              </div>
            </div>

            <div v-if="showsItems" class="ad-f c3">
              <span>每行列数</span>
              <div class="ad-seg">
                <button
                  v-for="n in 4"
                  :key="n"
                  type="button"
                  class="ad-seg__btn"
                  :class="{ 'is-on': form.columns === n }"
                  :disabled="n > maxColumns"
                  @click="form.columns = n"
                >
                  {{ n }}
                </button>
              </div>
              <p v-if="maxColumns < 4" class="ad-hint">
                「{{ CARD_TYPE_LABELS[form.cardType] }}」最多 {{ maxColumns }} 列
              </p>
            </div>

            <div v-if="isItems && !isHomePage" class="ad-f c3">
              <span>每页展示数</span>
              <AdminStepper v-model="form.pageSize" :min="1" :max="100" />
            </div>

            <div v-if="isChildren" class="ad-f c3">
              <span>每个子页面的预览条数</span>
              <AdminStepper v-model="form.latestLimit" :min="1" :max="50" />
            </div>

            <div v-if="isChildren" class="ad-f c6">
              <span>显示子页面详情</span>
              <button
                type="button"
                class="ad-sw"
                :class="{ 'is-off': !form.showChildDetail }"
                @click="form.showChildDetail = !form.showChildDetail"
              >
                <span class="ad-sw__track" />{{
                  form.showChildDetail ? '显示「共 N 篇」与「查看全部」' : '不显示「共 N 篇」与「查看全部」'
                }}
              </button>
            </div>

            <div class="ad-f c6">
              <span>页面封面</span>
              <button
                type="button"
                class="ad-sw"
                :class="{ 'is-off': !form.showCover }"
                @click="form.showCover = !form.showCover"
              >
                <span class="ad-sw__track" />{{ form.showCover ? '显示页面封面图' : '不显示页面封面图' }}
              </button>
            </div>

            <label v-if="form.showCover" class="ad-f c6">
              <span>封面图地址</span>
              <input v-model="form.coverImage" class="ad-input" type="text" placeholder="/media/xxx.jpg 或 /uploads/..." />
            </label>
          </div>

          <p v-if="isHomePage || isItems || staticBody" class="ad-hint" style="margin-top: 12px">
            <template v-if="isHomePage">
              首页由独立模板渲染「最新事项」，不使用「展示类型」，所以该项置灰；「每行列数」在首页同样生效。
            </template>
            <template v-else-if="isItems">
              「条目项」把文章铺成条目：每行列数为 1 时即单列列表，大于 1 时即多列网格；
              每页展示数就是翻页按钮的每页条数。
            </template>
            <template v-else-if="staticBody">「静态文本」只渲染下方正文，不铺文章条目。</template>
          </p>
        </section>

        <!-- 条目项：条目内容与条目来源，仅在「条目项」铺条目时使用 -->
        <section v-if="showsItems" class="ad-card">
          <div class="ad-card__head">
            <h2 class="ad-card__title">条目项</h2>
          </div>

          <div class="ad-group" style="margin-top: 0; padding-top: 0; border-top: none">
            <p class="ad-group__label">条目来源</p>
            <div class="ad-seg ad-seg--block" style="max-width: 420px">
              <button
                v-for="(label, key) in CONTENT_SOURCE_LABELS"
                :key="key"
                type="button"
                class="ad-seg__btn"
                :class="{ 'is-on': form.contentSource === key }"
                @click="setSource(key)"
              >
                {{ label }}
              </button>
            </div>

            <p v-if="form.contentSource === 'posts'" class="ad-hint" style="margin-top: 10px">
              本页显示「展示页面」中勾选了本页的文章。到文章编辑页把文章的展示页面勾上本页即可收录。
            </p>

            <div v-else-if="form.contentSource === 'aggregate'" style="margin-top: 12px">
              <p class="ad-hint" style="margin: 0 0 8px">
                本页会汇总所选页面里的全部文章，无需再单独给文章勾选本页。
              </p>
              <div class="ad-checks">
                <label v-for="p in aggregateOptions" :key="p.id" class="ad-check">
                  <input v-model="form.aggregatePages" type="checkbox" :value="p.id" />
                  {{ p.label }}
                </label>
              </div>
              <p v-if="!aggregateOptions.length" class="ad-hint">还没有其它页面可聚合。</p>
            </div>

            <div v-else-if="form.contentSource === 'latest'" class="ad-f" style="margin-top: 12px; max-width: 260px">
              <span>最新文章条数</span>
              <AdminStepper v-model="form.latestLimit" :min="0" :max="50" />
              <p class="ad-hint">填 0 表示不限条数，展示全部最新文章。</p>
            </div>
          </div>

          <div v-if="form.contentSource === 'posts'" class="ad-group">
            <p class="ad-group__label">标签筛选</p>
            <button
              type="button"
              class="ad-sw"
              :class="{ 'is-off': !form.tagFilter }"
              @click="form.tagFilter = !form.tagFilter"
            >
              <span class="ad-sw__track" />{{ form.tagFilter ? '启用标签筛选面板' : '不启用标签筛选面板' }}
            </button>
            <label v-if="form.tagFilter" class="ad-f" style="margin-top: 12px; max-width: 420px">
              <span>本页持有的标签（逗号分隔，顺序即面板顺序）</span>
              <input v-model="form.tagsText" class="ad-input" type="text" placeholder="如：C++, C#, Unity, 算法" />
            </label>
            <p v-if="form.tagFilter" class="ad-hint" style="margin-top: 8px">
              这些标签由本页持有，只会出现在勾选了本页的文章的标签选项中。面板出现在条目左侧。
            </p>
          </div>

          <div class="ad-group">
            <p class="ad-group__label">条目类型</p>
            <div class="ad-types">
              <button
                v-for="(label, key) in CARD_TYPE_LABELS"
                :key="key"
                type="button"
                class="ad-type"
                :class="{ 'is-on': form.cardType === key }"
                @click="setCardType(key)"
              >
                <PageCardTypeThumb :type="key" />
                <span>{{ label }}</span>
              </button>
            </div>
          </div>

          <div v-if="canSetAspectRatio" class="ad-group">
            <p class="ad-group__label">卡片宽高比</p>
            <div class="ad-seg ad-seg--block" style="max-width: 520px">
              <button
                v-for="(label, key) in ASPECT_RATIO_LABELS"
                :key="key"
                type="button"
                class="ad-seg__btn"
                :class="{ 'is-on': form.aspectRatio === key }"
                @click="setAspectRatio(key)"
              >
                {{ label }}
              </button>
            </div>
            <p class="ad-hint" style="margin-top: 10px">
              仅「全图叠加 / 网格卡」可设；选「默认」保持卡片原有比例，设了之后卡片高度随宽度按比例变化。
            </p>
          </div>

          <div class="ad-group">
            <div class="ad-card__head" style="margin-bottom: 12px">
              <p class="ad-group__label" style="margin: 0">条目显示字段</p>
              <button class="ad-btn ad-btn--sm" type="button" @click="applyFieldDefaults">恢复默认字段</button>
            </div>
            <div class="ad-chips">
              <button
                v-for="(label, key) in ITEM_FIELD_LABELS"
                :key="key"
                type="button"
                class="ad-toggle"
                :class="{ 'is-on': !!form.itemFields[key] }"
                @click="form.itemFields[key] = !form.itemFields[key]"
              >
                <i>{{ form.itemFields[key] ? '✓' : '+' }}</i>{{ label }}
              </button>
            </div>
            <p class="ad-hint" style="margin-top: 10px">
              条目类型决定卡片外观，显示字段只决定卡片里显示哪些内容，二者互不影响。
            </p>
          </div>

          <div v-if="canSetDatePosition" class="ad-group">
            <p class="ad-group__label">日期位置</p>
            <div class="ad-seg" style="max-width: 420px">
              <button
                v-for="(label, key) in DATE_POSITION_LABELS"
                :key="key"
                type="button"
                class="ad-seg__btn"
                :class="{ 'is-on': form.datePosition === key }"
                @click="setDatePosition(key)"
              >
                {{ label }}
              </button>
            </div>
            <p class="ad-hint" style="margin-top: 10px">
              仅「全图叠加 / 网格卡」且勾选了「日期」时可调；换成其它条目类型或取消勾选日期后该项自动隐藏。
            </p>
          </div>
        </section>

        <!-- 静态正文：仅展示类型为「静态文本」时使用 -->
        <section v-if="staticBody" class="ad-card">
          <div class="ad-card__head">
            <h2 class="ad-card__title">正文</h2>
          </div>
          <!-- 单栏源码编辑：渲染效果统一看右栏「效果预览」，不再内嵌第二个预览框 -->
          <div class="ad-editor">
            <div class="ad-editor__pane">
              <textarea v-model="form.content" class="ad-textarea ad-editor__code" spellcheck="false" />
            </div>
          </div>
        </section>
      </div>

      <!-- 右栏：效果预览（随滚动吸顶） -->
      <aside class="ad-preview-panel">
        <div class="ad-preview-panel__bar">
          <strong>效果预览</strong>
          <span>{{ form.title || '未命名页面' }} · {{ previewPath }}</span>
        </div>
        <div class="ad-preview-panel__body">
          <PagePreview
            :page="previewPage"
            :posts="previewPosts"
            :tags="previewTags"
            :page-labels="previewPageLabels"
            :child-pages="previewChildPages"
            :content-html="previewHtml"
            empty-hint="暂无内容。"
          />
        </div>
        <div class="ad-preview-panel__foot">
          预览为缩略示意，条目数据取自已保存的内容；改动「条目来源」或新增文章后，保存并刷新即可生效。
        </div>
      </aside>
    </div>
  </div>
</template>