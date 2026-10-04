<script setup lang="ts">
import type { NavPage, NavPageTag, Post } from '~/composables/useSiteData'

// 后台编辑页右侧的「效果预览」。直接复用前台的 PageItem / 容器规则渲染，
// 所见即所得；用一个固定宽度画布 + zoom 缩放塞进窄栏，避免为预览另写一套卡片。
const props = withDefaults(
  defineProps<{
    page: NavPage
    posts?: Post[]
    tags?: NavPageTag[]
    pageLabels?: Record<string, string>
    /** 展示类型为「子页面」时的子页面清单 */
    childPages?: { id: number; title: string; count: number }[]
    /** 静态正文已渲染好的 HTML */
    contentHtml?: string
    emptyHint?: string
  }>(),
  {
    posts: () => [],
    tags: () => [],
    pageLabels: () => ({}),
    childPages: () => [],
    contentHtml: '',
    emptyHint: '暂无内容。',
  },
)

const cols = computed(() => Math.max(1, props.page.columns || 1))
const pageSize = computed(() => Math.max(1, props.page.pageSize || 10))
const items = computed(() => props.posts.slice(0, pageSize.value))
const totalPages = computed(() => Math.max(1, Math.ceil(props.posts.length / pageSize.value)))
const gridStyle = computed(() => ({ '--cols': String(cols.value) }))

// 画布固定 800px 宽以便复用前台容器规则，再按右栏实际可用宽度折算 zoom，
// 让预览恰好铺满预览框（CSS 里的 zoom 只作首帧兜底）。
const { el: canvasEl } = usePreviewFit(800)
</script>

<template>
  <div ref="canvasEl" class="pv__canvas">
    <!-- 子页面总览页前台不再显示自己的标题，预览跟着保持一致 -->
    <h1 v-if="props.page.layout !== 'children'" class="pv__title">
      {{ props.page.title || '未命名页面' }}
    </h1>

    <!-- 条目项：复用前台条目与网格规则 -->
    <template v-if="props.page.layout === 'items'">
      <p class="pv__count">
        共 {{ props.posts.length }} 篇
        <template v-if="!props.page.isHome"> · 每页 {{ pageSize }} 条</template>
      </p>

      <div v-if="props.page.tagFilter && props.tags.length" class="pv__tags">
        <span class="pv__tag is-on">全部 <b>{{ props.posts.length }}</b></span>
        <span v-for="t in props.tags" :key="t.name" class="pv__tag">{{ t.name }} <b>{{ t.count }}</b></span>
      </div>

      <div v-if="items.length" class="pv__grid" :class="{ 'is-single': cols === 1 }" :style="gridStyle">
        <PageItem
          v-for="p in items"
          :key="p.id"
          :post="p"
          :page="props.page"
          :page-labels="props.pageLabels"
        />
      </div>
      <p v-else class="pv__empty">{{ props.emptyHint }}</p>

      <div v-if="totalPages > 1" class="pv__pager">
        <span class="pv__page is-nav">‹</span>
        <span
          v-for="n in Math.min(totalPages, 5)"
          :key="n"
          class="pv__page"
          :class="{ 'is-on': n === 1 }"
        >
          {{ n }}
        </span>
        <span class="pv__page is-nav">›</span>
      </div>
    </template>

    <!-- 静态文本：正文按 Markdown 渲染 -->
    <template v-else-if="props.page.layout === 'static'">
      <div v-if="props.contentHtml" class="gg-content pv__content" v-html="props.contentHtml" />
      <p v-else class="pv__empty">正文还是空的。</p>
    </template>

    <!-- 子页面：竖排子页面总览 -->
    <template v-else>
      <p class="pv__count">共 {{ props.childPages.length }} 个子页面</p>
      <div v-if="props.childPages.length" class="pv__children">
        <div v-for="c in props.childPages" :key="c.id" class="pv__child">
          <span class="pv__child-title">{{ c.title }}</span>
          <!-- 与前台一致：关掉「显示子页面详情」后不再出现「共 N 篇」 -->
          <span v-if="props.page.showChildDetail" class="pv__child-count">共 {{ c.count }} 篇</span>
        </div>
      </div>
      <p v-else class="pv__empty">还没有子页面。</p>
    </template>
  </div>
</template>

<style scoped>
/* 固定宽度画布 + zoom：整页按比例缩进窄栏，高度自动跟随内容。
   zoom 默认值仅作首帧 / SSR 兜底，挂载后由 usePreviewFit 按面板实际宽度改写。 */
.pv__canvas {
  width: 800px;
  zoom: var(--pgv-zoom, 0.5);
  padding: 26px 24px 30px;
  background: var(--gg-bg);
  color: var(--gg-ink);
}
.pv__title { font-family: var(--gg-serif); font-size: 2.4rem; margin: 0 0 6px; line-height: 1.25; }
.pv__count { color: var(--gg-muted); font-size: 0.95rem; margin: 0 0 16px; }

.pv__tags { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
.pv__tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border: 1px solid var(--gg-border);
  border-radius: 999px;
  background: var(--gg-surface);
  font-size: 0.85rem;
  color: var(--gg-inksoft);
}
.pv__tag b { font-weight: 500; color: var(--gg-muted); }
.pv__tag.is-on { background: var(--gg-ink); border-color: var(--gg-ink); color: #fff; }
.pv__tag.is-on b { color: rgba(255, 255, 255, 0.72); }

/* 与前台 PageItems 的容器规则一致：列数由配置驱动，单列即列表 */
.pv__grid {
  display: grid;
  grid-template-columns: repeat(var(--cols, 1), minmax(0, 1fr));
  gap: 20px;
  align-items: start;
  /* 预览纯展示：禁用条目点击，避免误跳走 */
  pointer-events: none;
}
.pv__grid.is-single { gap: 12px; }

.pv__empty { color: var(--gg-muted); margin: 12px 0 0; }

.pv__pager { display: flex; gap: 6px; margin-top: 24px; }
.pv__page {
  min-width: 32px;
  padding: 5px 9px;
  text-align: center;
  border: 1px solid var(--gg-border);
  border-radius: 8px;
  background: var(--gg-surface);
  font-size: 0.85rem;
  color: var(--gg-inksoft);
}
.pv__page.is-on { background: var(--gg-ink); border-color: var(--gg-ink); color: #fff; }
.pv__page.is-nav { color: var(--gg-muted); }

.pv__content { pointer-events: none; }

.pv__children { display: grid; gap: 12px; }
.pv__child {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  background: var(--gg-surface);
  border: 1px solid var(--gg-border);
  border-radius: var(--gg-radius);
}
.pv__child-title { font-family: var(--gg-serif); font-size: 1.35rem; }
.pv__child-count { color: var(--gg-muted); font-size: 0.88rem; }
</style>