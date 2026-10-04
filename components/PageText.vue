<script setup lang="ts">
import type { NavPage } from '~/composables/useSiteData'
import { pageHtml } from '~/composables/useSiteData'

const props = defineProps<{ page: NavPage }>()
const html = computed(() => pageHtml(props.page))
</script>

<template>
  <section class="page-text">
    <h1 class="page-text__title">{{ props.page.title }}</h1>
    <div v-if="html" class="page-text__content gg-content" v-html="html" />
    <p v-else class="page-text__empty">暂无内容。</p>
  </section>
</template>

<style scoped>
.page-text {
  max-width: var(--gg-max);
  margin: 0 auto;
  padding: 40px 24px;
}
.page-text__title { font-size: 2.4rem; margin: 0 0 20px; }
.page-text__empty { color: var(--gg-muted); }
</style>