<script setup lang="ts">
definePageMeta({ layout: 'admin' })
useHead({ title: '概览面板 — GarfieldGod 后台' })

const { data: stats } = await useFetch<AdminStats>('/api/admin/stats', { key: 'admin-stats' })
const { data: postData } = await useFetch<{ posts: AdminPost[] }>('/api/admin/posts', { key: 'admin-posts' })
const { data: commentData } = await useFetch<{ comments: AdminComment[] }>('/api/admin/comments', {
  key: 'admin-comments',
})

const cards = computed(() => [
  { label: '已发布', value: stats.value?.posts ?? 0 },
  { label: '草稿', value: stats.value?.drafts ?? 0 },
  { label: '评论', value: stats.value?.comments ?? 0 },
  { label: '已隐藏评论', value: stats.value?.hiddenComments ?? 0 },
  { label: '总阅读', value: stats.value?.views ?? 0 },
  { label: '页面', value: stats.value?.pages ?? 0 },
])

const recentPosts = computed(() => (postData.value?.posts ?? []).slice(0, 5))
const recentComments = computed(() => (commentData.value?.comments ?? []).slice(0, 5))
</script>

<template>
  <div>
    <div class="ad-head">
      <div>
        <h1 class="ad-title">概览面板</h1>
        <p class="ad-sub">站点内容概览</p>
      </div>
      <div class="ad-actions">
        <NuxtLink class="ad-btn ad-btn--primary" to="/admin/posts/new">写新文章</NuxtLink>
      </div>
    </div>

    <div class="ad-stats">
      <div v-for="c in cards" :key="c.label" class="ad-stat">
        <div class="ad-stat__label">{{ c.label }}</div>
        <div class="ad-stat__value">{{ c.value }}</div>
      </div>
    </div>

    <section class="ad-card" style="margin-top: 16px">
      <div class="ad-card__head">
        <h2 class="ad-card__title">最近文章</h2>
        <NuxtLink class="ad-hint" to="/admin/posts">全部文章</NuxtLink>
      </div>
      <div v-if="recentPosts.length" class="ad-scroll">
        <table class="ad-table">
          <thead>
            <tr>
              <th>标题</th>
              <th>状态</th>
              <th class="ad-table__nowrap">日期</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in recentPosts" :key="p.id">
              <td><NuxtLink class="ad-table__title" :to="`/admin/posts/${p.id}`">{{ p.title }}</NuxtLink></td>
              <td>
                <span class="ad-badge" :class="p.status === 'draft' ? 'is-draft' : 'is-published'">
                  {{ p.status === 'draft' ? '草稿' : '已发布' }}
                </span>
              </td>
              <td class="ad-table__num ad-table__nowrap">{{ formatDateTime(p.date) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="ad-empty">还没有文章。</p>
    </section>

    <section class="ad-card">
      <div class="ad-card__head">
        <h2 class="ad-card__title">最新评论</h2>
        <NuxtLink class="ad-hint" to="/admin/comments">全部评论</NuxtLink>
      </div>
      <ul v-if="recentComments.length" class="ad-list">
        <li v-for="c in recentComments" :key="c.id" class="ad-list__item">
          <div class="ad-list__head">
            <strong>{{ c.author }}</strong>
            <span class="ad-hint">{{ formatDateTime(c.date) }}</span>
          </div>
          <p class="ad-list__body">{{ c.content }}</p>
          <span class="ad-hint">来自：{{ c.postTitle }}</span>
        </li>
      </ul>
      <p v-else class="ad-empty">还没有评论。</p>
    </section>
  </div>
</template>

<style scoped>
.ad-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.ad-list__item { padding: 12px 14px; border: 1px solid var(--gg-border); border-radius: 10px; }
.ad-list__head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.ad-list__body {
  margin: 6px 0;
  font-size: 0.88rem;
  color: var(--gg-inksoft);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
</style>
