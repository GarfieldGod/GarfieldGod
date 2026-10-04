<script setup lang="ts">
import { tabName, tabTagline } from '~/composables/useSiteData'

// 首页形态（最新 N 篇）来自 nav_pages 的 home 页配置
const { data } = await useNavPage('home')

// 标签页标题由「站点信息」的站名 + 标语拼成（独立于导航栏的名称/签名），后台改这两项即时生效
const { data: meta } = await useSiteMeta()
useHead({ title: () => `${tabName(meta.value)} — ${tabTagline(meta.value)}` })

const page = computed(() => data.value?.page)
const latestPosts = computed(() => data.value?.posts ?? [])
// 列数由页面配置驱动；条目外观（卡片形态）由条目类型决定
const listStyle = computed(() => ({ '--cols': String(page.value?.columns || 1) }))
</script>

<template>
  <div class="home">
    <section class="latest" id="latest">
      <h2 class="section-title">最新事项</h2>

      <div v-if="page" class="post-list" :style="listStyle">
        <PageItem v-for="p in latestPosts" :key="p.id" :post="p" :page="page" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.latest {
  max-width: var(--gg-max);
  margin: 0 auto;
  padding: 48px 24px 0;
}
.section-title {
  font-size: 2.4rem;
  margin: 0 0 26px;
  padding-bottom: 12px;
  border-bottom: 2px solid var(--gg-border);
}

.post-list {
  display: grid;
  grid-template-columns: repeat(var(--cols, 1), minmax(0, 1fr));
  gap: 24px;
  align-items: start;
}

@media (max-width: 720px) {
  .post-list { grid-template-columns: minmax(0, 1fr); }
}
</style>