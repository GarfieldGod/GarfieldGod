<script setup lang="ts">
import type { ChildSection, NavPage, NavPageTag, Post } from '~/composables/useSiteData'

// 页面根节点必须是单个元素（模板顶层不能有注释/文本），否则 Nuxt 的页面过渡在
// 路由间切换时会报错并留下空白页。这里用一条 v-if/v-else-if 链保证只渲染一个分支。
// 分支完全由「展示类型」决定：子页面 → 竖排总览，静态文本 → 正文，条目项 → 铺条目。
const props = defineProps<{
  page: NavPage
  posts: Post[]
  childSections: ChildSection[]
  tags: NavPageTag[]
  /** 页面 id → 页面标题，用于条目上的所属页面胶囊 */
  pageLabels: Record<string, string>
}>()
</script>

<template>
  <PageChildren
    v-if="props.page.layout === 'children'"
    :page="props.page"
    :child-sections="props.childSections"
    :page-labels="props.pageLabels"
  />

  <PageText v-else-if="props.page.layout === 'static'" :page="props.page" />

  <PageItems
    v-else
    :page="props.page"
    :posts="props.posts"
    :tags="props.tags"
    :page-labels="props.pageLabels"
  />
</template>