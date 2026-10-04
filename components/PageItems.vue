<script setup lang="ts">
import type { NavPage, NavPageTag, Post } from '~/composables/useSiteData'

const props = withDefaults(
  defineProps<{
    page: NavPage
    posts: Post[]
    tags?: NavPageTag[]
    pageLabels?: Record<string, string>
    /** 嵌在「子页面总览」里做预览：隐去标题、筛选与分页，直接铺开传入的文章 */
    embedded?: boolean
  }>(),
  { tags: () => [], pageLabels: () => ({}), embedded: false },
)

const route = useRoute()
const router = useRouter()

// 「条目项」只有一种容器：每行列数决定单列（列表）还是多列（网格），
// 每页展示数决定翻页大小；条目外观交给 PageItem（跟随条目类型）。
const cols = computed(() => Math.max(1, props.page.columns || 1))
const pageSize = computed(() => Math.max(1, props.page.pageSize || 10))
const gridStyle = computed(() => ({ '--cols': String(cols.value) }))

const showFilter = computed(() => !props.embedded && props.page.tagFilter && props.tags.length > 0)

// 未知标签（过期链接等）回退为「全部」，避免落到空列表且没有选中项
const activeTag = computed(() => {
  const raw = String(route.query.tag ?? '').trim()
  return props.tags.some((t) => t.name === raw) ? raw : ''
})

const visiblePosts = computed(() =>
  activeTag.value
    ? props.posts.filter((p) => (p.tags ?? []).some((t) => t.name === activeTag.value))
    : props.posts,
)

const totalPages = computed(() => Math.max(1, Math.ceil(visiblePosts.value.length / pageSize.value)))
const currentPage = computed(() => {
  const raw = Number(route.query.page)
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1
})
const safePage = computed(() => Math.min(currentPage.value, totalPages.value))
const pagedPosts = computed(() => {
  if (props.embedded) return visiblePosts.value
  const start = (safePage.value - 1) * pageSize.value
  return visiblePosts.value.slice(start, start + pageSize.value)
})

function pushQuery(query: Record<string, string>) {
  router.push({ path: route.path, query })
}

// 翻页保留当前筛选，切换筛选则回到第 1 页
function goPage(n: number) {
  const p = Math.min(Math.max(1, n), totalPages.value)
  const query: Record<string, string> = {}
  if (activeTag.value) query.tag = activeTag.value
  if (p > 1) query.page = String(p)
  pushQuery(query)
}

function setTag(tag: string) {
  pushQuery(tag ? { tag } : {})
}

// 注意：模板顶层不能放注释。PageRenderer 会把本组件直接作为页面根节点，
// 顶层注释会让根变成片段节点，Nuxt 的 out-in 页面过渡挂不上元素，进而偶发白屏。
</script>

<template>
  <section class="cat-page" :class="{ 'is-embedded': props.embedded }">
    <header v-if="!props.embedded" class="cat-page__head">
      <h1 class="cat-page__title">{{ props.page.title }}</h1>
      <p class="cat-page__count">共 {{ visiblePosts.length }} 篇</p>
      <div class="cat-page__bar">
        <PagePager :current="safePage" :total="totalPages" variant="inline" @go="goPage" />
      </div>
    </header>

    <div class="cat-page__body">
      <PageTagFilter
        v-if="showFilter"
        :tags="props.tags"
        :active="activeTag"
        :total="props.posts.length"
        @select="setTag"
      />

      <div class="cat-page__main">
        <div class="cat-page__grid" :class="{ 'is-single': cols === 1 }" :style="gridStyle">
          <PageItem
            v-for="p in pagedPosts"
            :key="p.id"
            :post="p"
            :page="props.page"
            :page-labels="props.pageLabels"
          />
        </div>

        <p v-if="!visiblePosts.length" class="cat-page__empty">暂无内容。</p>

        <PagePager v-if="!props.embedded" :current="safePage" :total="totalPages" variant="bottom" @go="goPage" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.cat-page {
  max-width: var(--gg-max);
  margin: 0 auto;
  padding: 40px 24px;
}
.cat-page__head {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin: 0 0 20px;
}
.cat-page__title { font-size: 2.4rem; margin: 0; }
/* 嵌入预览：去掉页面级的外边距与标题间距，由外层「子页面总览」控制分节。
   margin 必须一并归零——它是 grid 子项，auto 外边距会让它收缩到内容宽度而非撑满整列 */
.cat-page.is-embedded { max-width: none; padding: 0; margin: 0; }
.cat-page__body { display: flex; align-items: flex-start; gap: 32px; }
.cat-page__main { flex: 1 1 auto; min-width: 0; }

/* 标题行：标题 + 紧挨着的「共 N 篇」，翻页容器靠右 */
.cat-page__bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  margin: 0 0 0 auto;
}
.cat-page__count { color: var(--gg-muted); margin: 0; }

/* 列数由页面配置驱动；单列时收紧间距，视觉上就是列表 */
.cat-page__grid {
  display: grid;
  grid-template-columns: repeat(var(--cols, 1), minmax(0, 1fr));
  gap: 20px;
  align-items: start;
}
.cat-page__grid.is-single { gap: 12px; }
.cat-page__empty { color: var(--gg-muted); margin: 12px 0 0; }

@media (max-width: 860px) {
  .cat-page__body { flex-direction: column; gap: 20px; }
}
@media (max-width: 720px) {
  /* 单列列表不参与降列，保持一列 */
  .cat-page__grid:not(.is-single) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 460px) {
  .cat-page__grid { grid-template-columns: minmax(0, 1fr); }
}
</style>