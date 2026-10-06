<script setup lang="ts">
import { tabName } from '~/composables/useSiteData'

// 数据驱动页面：路由路径即 nav_pages.slug（如 /category/notes、/tools、/personal）。
// 首页 / 与文章详情 /post/:id、后台 /admin 仍是独立文件。
//
// 注意：<template> 顶层只能有那一个根元素，不能出现注释或文本节点。
// 注释也是根节点，会让 Nuxt 的页面过渡在路由切换时渲染失败——从本页点进文章会白屏，
// 刷新才恢复。说明文字一律写在 script 里，别放回模板顶层。
const route = useRoute()

const raw = route.params.path
const slug = Array.isArray(raw) ? raw.join('/') : String(raw ?? '')
if (!slug) throw createError({ statusCode: 404, message: '页面不存在', fatal: true })

const res = useNavPage(slug)
// 服务端要等数据到齐才输出完整 HTML（SEO 与 404 判定）；
// 客户端导航不等接口，立刻切页——数据由空闲预热提前备好，命中缓存时同步就有内容。
if (import.meta.server) await res
const { data, error } = res

if (import.meta.server && (error.value || !data.value?.page)) {
  throw createError({ statusCode: 404, message: '页面不存在', fatal: true })
}
// 客户端导航时数据后到：确实不存在再落到错误页
watch(error, (e) => {
  if (e) showError(createError({ statusCode: 404, message: '页面不存在', fatal: true }))
})

const page = computed(() => data.value?.page)

// 标签页标题：页面名 — 站名（站名独立于导航栏「名称」，来自「站点信息」，后台可改）
const { data: meta } = await useSiteMeta()
useHead({
  title: () => (page.value ? `${page.value.title} — ${tabName(meta.value)}` : tabName(meta.value)),
})
</script>

<template>
  <div class="page-shell">
    <PageRenderer
      v-if="page"
      :page="page"
      :posts="data?.posts ?? []"
      :child-sections="data?.childSections ?? []"
      :tags="data?.tags ?? []"
      :page-labels="data?.pageLabels ?? {}"
    />
  </div>
</template>