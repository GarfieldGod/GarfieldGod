<script setup lang="ts">
import { tabName } from '~/composables/useSiteData'

// 数据驱动页面：路由路径即 nav_pages.slug（如 /category/notes、/tools、/personal）。
// 首页 / 与文章详情 /post/:id、后台 /admin 仍是独立文件。
const route = useRoute()

const raw = route.params.path
const slug = Array.isArray(raw) ? raw.join('/') : String(raw ?? '')
if (!slug) throw createError({ statusCode: 404, message: '页面不存在', fatal: true })

const { data, error } = await useNavPage(slug)
if (error.value || !data.value?.page) {
  throw createError({ statusCode: 404, message: '页面不存在', fatal: true })
}

const page = computed(() => data.value!.page)

// 标签页标题：页面名 — 站名（站名独立于导航栏「名称」，来自「站点信息」，后台可改）
const { data: meta } = await useSiteMeta()
useHead({ title: () => `${page.value.title} — ${tabName(meta.value)}` })
</script>

<template>
  <PageRenderer
    :page="page"
    :posts="data?.posts ?? []"
    :child-sections="data?.childSections ?? []"
    :tags="data?.tags ?? []"
    :page-labels="data?.pageLabels ?? {}"
  />
</template>