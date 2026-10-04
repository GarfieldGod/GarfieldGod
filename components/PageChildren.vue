<script setup lang="ts">
import type { ChildSection, NavPage } from '~/composables/useSiteData'
import { navPagePath, pageHtml } from '~/composables/useSiteData'

const props = defineProps<{
  page: NavPage
  childSections: ChildSection[]
  pageLabels: Record<string, string>
}>()

// 每个子页面用自己配置的形态呈现：条目项铺条目预览，静态文本铺正文
function mode(s: ChildSection): 'text' | 'items' | 'empty' {
  if (s.page.layout === 'items') return 'items'
  if (s.page.layout === 'static') return pageHtml(s.page) ? 'text' : 'empty'
  return 'empty'
}
</script>

<template>
  <section class="overview">
    <div v-if="props.childSections.length" class="overview__list">
      <section v-for="s in props.childSections" :key="s.page.id" class="child">
        <header class="child__head">
          <h2 class="child__title">
            <!-- 关掉「显示子页面详情」时，这块就只是本页的一个分节，标题不再跳去子页面 -->
            <NuxtLink v-if="props.page.showChildDetail" :to="navPagePath(s.page)">
              {{ s.page.title }}
            </NuxtLink>
            <span v-else>{{ s.page.title }}</span>
          </h2>
          <!-- 子页面详情：可在页面设置里整体关掉，关掉后每个子块只剩标题与内容 -->
          <template v-if="props.page.showChildDetail">
            <span v-if="s.total" class="child__count">共 {{ s.total }} 篇</span>
            <NuxtLink class="child__more" :to="navPagePath(s.page)">查看全部</NuxtLink>
          </template>
        </header>

        <div v-if="mode(s) === 'text'" class="child__text gg-content" v-html="pageHtml(s.page)" />

        <PageItems
          v-else-if="mode(s) === 'items'"
          :page="s.page"
          :posts="s.posts"
          :page-labels="props.pageLabels"
          embedded
        />

        <p v-else class="child__empty">暂无内容。</p>
      </section>
    </div>

    <p v-else class="overview__empty">暂无内容。</p>
  </section>
</template>

<style scoped>
.overview {
  max-width: var(--gg-max);
  margin: 0 auto;
  padding: 40px 24px;
}
/* 总览页不再显示自己的页面标题：导航里已经有同一个名字，再摆一个大标题只是重复 */
.overview__empty { color: var(--gg-muted); margin: 0; }

/* 各子页面竖排：每段一个标题栏，下面铺该子页面的内容 */
.overview__list { display: grid; gap: 52px; }
.child { display: grid; gap: 18px; }

.child__head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--gg-border);
}
.child__title { font-size: 1.5rem; margin: 0; }
.child__title a { color: inherit; text-decoration: none; transition: color 0.15s; }
.child__title a:hover { color: var(--gg-accent); }
.child__count { font-size: 0.85rem; color: var(--gg-muted); }
.child__more {
  margin-left: auto;
  font-size: 0.9rem;
  color: var(--gg-inksoft);
  text-decoration: none;
  white-space: nowrap;
  transition: color 0.15s;
}
.child__more:hover { color: var(--gg-accent); }

.child__text { color: var(--gg-inksoft); }
.child__empty { color: var(--gg-muted); margin: 0; }

@media (max-width: 560px) {
  .child__head { flex-wrap: wrap; gap: 8px; }
  .child__more { margin-left: 0; }
}
</style>