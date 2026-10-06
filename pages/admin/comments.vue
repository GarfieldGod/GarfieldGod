<script setup lang="ts">
import { sessionCachedData } from '~/composables/useSiteData'

definePageMeta({ layout: 'admin' })
useHead({ title: '评论 — GarfieldGod 后台' })

const { data, refresh } = useFetch<{ comments: AdminComment[] }>('/api/admin/comments', {
  key: 'admin-comments',
  getCachedData: sessionCachedData,
})

const filter = ref<'all' | 'approved' | 'hidden'>('all')
const busyId = ref<number | null>(null)
const message = ref('')
const failed = ref(false)

const comments = computed(() => {
  const list = data.value?.comments ?? []
  return filter.value === 'all' ? list : list.filter((c) => c.status === filter.value)
})

async function setStatus(comment: AdminComment, status: 'approved' | 'hidden') {
  busyId.value = comment.id
  message.value = ''
  try {
    await $fetch(`/api/admin/comments/${comment.id}`, { method: 'PATCH', body: { status } })
    await refresh()
    await refreshNuxtData('admin-stats')
    failed.value = false
    message.value = status === 'approved' ? '已通过。' : '已隐藏。'
  } catch (e) {
    failed.value = true
    message.value = adminError(e, '操作失败')
  } finally {
    busyId.value = null
  }
}

async function remove(comment: AdminComment) {
  if (!confirm(`确定删除 ${comment.author} 的这条留言？`)) return
  busyId.value = comment.id
  message.value = ''
  try {
    await $fetch(`/api/admin/comments/${comment.id}`, { method: 'DELETE' })
    await refresh()
    await refreshNuxtData('admin-stats')
    failed.value = false
    message.value = '已删除。'
  } catch (e) {
    failed.value = true
    message.value = adminError(e, '删除失败')
  } finally {
    busyId.value = null
  }
}
</script>

<template>
  <div>
    <div class="ad-head">
      <div>
        <h1 class="ad-title">评论</h1>
        <p class="ad-sub">共 {{ data?.comments.length ?? 0 }} 条</p>
      </div>
      <div class="ad-actions">
        <select v-model="filter" class="ad-select" style="width: auto">
          <option value="all">全部</option>
          <option value="approved">已通过</option>
          <option value="hidden">已隐藏</option>
        </select>
      </div>
    </div>

    <p v-if="message" class="ad-msg" :class="failed ? 'is-error' : 'is-ok'">{{ message }}</p>

    <div class="ad-card">
      <div v-if="comments.length" class="ad-scroll">
        <table class="ad-table">
          <thead>
            <tr>
              <th>作者</th>
              <th>内容</th>
              <th>来源文章</th>
              <th class="ad-table__nowrap">时间</th>
              <th>状态</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in comments" :key="c.id">
              <td class="ad-table__nowrap">
                {{ c.author }}
                <div v-if="c.authorEmail" class="ad-hint">{{ c.authorEmail }}</div>
              </td>
              <td class="ad-comment-body">{{ c.content }}</td>
              <td class="ad-hint">{{ c.postTitle }}</td>
              <td class="ad-table__num ad-table__nowrap">{{ formatDateTime(c.date) }}</td>
              <td>
                <span class="ad-badge" :class="c.status === 'hidden' ? 'is-hidden' : 'is-published'">
                  {{ c.status === 'hidden' ? '已隐藏' : '已通过' }}
                </span>
              </td>
              <td>
                <div class="ad-table__actions">
                  <button
                    class="ad-btn ad-btn--sm"
                    type="button"
                    :disabled="busyId === c.id"
                    @click="setStatus(c, c.status === 'hidden' ? 'approved' : 'hidden')"
                  >
                    {{ c.status === 'hidden' ? '通过' : '隐藏' }}
                  </button>
                  <button class="ad-btn ad-btn--sm ad-btn--danger" type="button" :disabled="busyId === c.id" @click="remove(c)">
                    删除
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="ad-empty">没有匹配的评论。</p>
    </div>
  </div>
</template>

<style scoped>
.ad-comment-body {
  min-width: 240px;
  max-width: 420px;
  font-size: 0.86rem;
  color: var(--gg-inksoft);
}
</style>
