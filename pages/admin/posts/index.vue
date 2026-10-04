<script setup lang="ts">
definePageMeta({ layout: 'admin' })
useHead({ title: '文章 — GarfieldGod 后台' })

const { data, refresh } = await useFetch<{ posts: AdminPost[] }>('/api/admin/posts', { key: 'admin-posts' })

const keyword = ref('')
const statusFilter = ref<'all' | 'published' | 'draft'>('all')
const pageFilter = ref<number | null>(null)
const tagFilter = ref<number | null>(null)
const busyId = ref<number | null>(null)
const message = ref('')

// 状态与关键词先过一遍，页面 / 标签的可选值和计数都以它为基数
const basePosts = computed(() => {
  const list = data.value?.posts ?? []
  const kw = keyword.value.trim().toLowerCase()
  return list.filter((p) => {
    if (statusFilter.value !== 'all' && p.status !== statusFilter.value) return false
    if (kw && !p.title.toLowerCase().includes(kw)) return false
    return true
  })
})

const pageOptions = computed(() => {
  const map = new Map<number, { id: number; title: string; count: number }>()
  for (const p of basePosts.value) {
    for (const pg of p.pages) {
      const hit = map.get(pg.id) ?? { id: pg.id, title: pg.title, count: 0 }
      hit.count += 1
      map.set(pg.id, hit)
    }
  }
  return [...map.values()].sort((a, b) => a.title.localeCompare(b.title, 'zh'))
})

// 标签由页面持有，选中页面后只列出归属该页面的标签
const tagOptions = computed(() => {
  if (pageFilter.value === null) return []
  const map = new Map<number, { id: number; name: string; count: number }>()
  for (const p of basePosts.value) {
    if (!p.pages.some((pg) => pg.id === pageFilter.value)) continue
    for (const t of p.tags) {
      if (t.pageId !== pageFilter.value) continue
      const hit = map.get(t.id) ?? { id: t.id, name: t.name, count: 0 }
      hit.count += 1
      map.set(t.id, hit)
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh'))
})

const pagePostCount = computed(() =>
  pageFilter.value === null
    ? 0
    : basePosts.value.filter((p) => p.pages.some((pg) => pg.id === pageFilter.value)).length,
)

// 换页面后原标签可能不再属于新页面，需要撤销，避免筛出空列表
watch(pageFilter, () => {
  if (tagFilter.value !== null && !tagOptions.value.some((t) => t.id === tagFilter.value)) {
    tagFilter.value = null
  }
})

const posts = computed(() =>
  basePosts.value.filter((p) => {
    if (pageFilter.value !== null && !p.pages.some((pg) => pg.id === pageFilter.value)) return false
    if (tagFilter.value !== null && !p.tags.some((t) => t.id === tagFilter.value)) return false
    return true
  }),
)

const hasFilter = computed(
  () =>
    statusFilter.value !== 'all' ||
    keyword.value.trim() !== '' ||
    pageFilter.value !== null ||
    tagFilter.value !== null,
)

function togglePage(id: number) {
  pageFilter.value = pageFilter.value === id ? null : id
}

function toggleTag(id: number) {
  tagFilter.value = tagFilter.value === id ? null : id
}

function resetFilters() {
  statusFilter.value = 'all'
  keyword.value = ''
  pageFilter.value = null
  tagFilter.value = null
}

async function remove(post: AdminPost) {
  if (!confirm(`确定删除《${post.title}》？该文章的评论与阅读数会一并删除，且不可恢复。`)) return
  busyId.value = post.id
  message.value = ''
  try {
    await $fetch(`/api/admin/posts/${post.id}`, { method: 'DELETE' })
    await refresh()
    message.value = '已删除。'
  } catch (e) {
    message.value = adminError(e, '删除失败')
  } finally {
    busyId.value = null
  }
}

async function toggleStatus(post: AdminPost) {
  busyId.value = post.id
  message.value = ''
  try {
    await $fetch(`/api/admin/posts/${post.id}`, {
      method: 'PUT',
      body: {
        title: post.title,
        date: post.date,
        content: post.content,
        excerpt: post.excerpt,
        featured: post.featured,
        pageIds: post.pages.map((p) => p.id),
        tagIds: post.tags.map((t) => t.id),
        status: post.status === 'published' ? 'draft' : 'published',
        format: post.format,
        // 这几个必须一并回传：后台的 PUT 是「整篇覆盖」，
        // 漏掉谁就会把谁重置成默认值（样式方案、样式设置、正文宽度、留言开关）
        contentWidth: post.contentWidth,
        postStyle: post.postStyle,
        postStyleOptions: post.postStyleOptions,
        allowComments: post.allowComments,
      },
    })
    await refresh()
  } catch (e) {
    message.value = adminError(e, '操作失败')
  } finally {
    busyId.value = null
  }
}
</script>

<template>
  <div>
    <div class="ad-head">
      <div>
        <h1 class="ad-title">文章</h1>
        <p class="ad-sub">共 {{ data?.posts.length ?? 0 }} 篇</p>
      </div>
      <div class="ad-actions">
        <NuxtLink class="ad-btn ad-btn--primary" to="/admin/posts/new">写新文章</NuxtLink>
      </div>
    </div>

    <div class="ad-card">
      <div class="ad-card__head">
        <div class="ad-actions">
          <select v-model="statusFilter" class="ad-select" style="width: auto">
            <option value="all">全部状态</option>
            <option value="published">已发布</option>
            <option value="draft">草稿</option>
          </select>
          <input v-model="keyword" class="ad-input" type="search" placeholder="搜索标题" style="width: 200px" />
        </div>
        <div class="ad-actions">
          <span class="ad-hint">筛选结果 {{ posts.length }} 篇</span>
          <button v-if="hasFilter" class="ad-btn ad-btn--sm" type="button" @click="resetFilters">清除筛选</button>
        </div>
      </div>

      <div class="ad-filter">
        <div class="ad-filter__row">
          <span class="ad-filter__label">页面</span>
          <div class="ad-chips">
            <button
              class="ad-chip"
              :class="{ 'is-active': pageFilter === null }"
              type="button"
              @click="pageFilter = null"
            >
              全部页面
              <span class="ad-chip__count">{{ basePosts.length }}</span>
            </button>
            <button
              v-for="pg in pageOptions"
              :key="pg.id"
              class="ad-chip"
              :class="{ 'is-active': pageFilter === pg.id }"
              type="button"
              @click="togglePage(pg.id)"
            >
              {{ pg.title }}
              <span class="ad-chip__count">{{ pg.count }}</span>
            </button>
          </div>
        </div>

        <div v-if="pageFilter !== null" class="ad-filter__row">
          <span class="ad-filter__label">标签</span>
          <div v-if="tagOptions.length" class="ad-chips">
            <button
              class="ad-chip"
              :class="{ 'is-active': tagFilter === null }"
              type="button"
              @click="tagFilter = null"
            >
              全部标签
              <span class="ad-chip__count">{{ pagePostCount }}</span>
            </button>
            <button
              v-for="t in tagOptions"
              :key="t.id"
              class="ad-chip"
              :class="{ 'is-active': tagFilter === t.id }"
              type="button"
              @click="toggleTag(t.id)"
            >
              {{ t.name }}
              <span class="ad-chip__count">{{ t.count }}</span>
            </button>
          </div>
          <span v-else class="ad-hint">该页面下的文章暂无标签。</span>
        </div>
      </div>

      <p v-if="message" class="ad-msg" :class="message.includes('失败') ? 'is-error' : 'is-ok'">{{ message }}</p>

      <div v-if="posts.length" class="ad-scroll">
        <table class="ad-table">
          <thead>
            <tr>
              <th>标题</th>
              <th>状态</th>
              <th>展示页面</th>
              <th class="ad-table__nowrap">日期</th>
              <th class="ad-table__nowrap">阅读</th>
              <th class="ad-table__nowrap">评论</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in posts" :key="p.id">
              <td>
                <NuxtLink class="ad-table__title" :to="`/admin/posts/${p.id}`">{{ p.title }}</NuxtLink>
                <div class="ad-hint">{{ p.format === 'markdown' ? 'Markdown' : 'HTML' }}</div>
              </td>
              <td>
                <span class="ad-badge" :class="p.status === 'draft' ? 'is-draft' : 'is-published'">
                  {{ p.status === 'draft' ? '草稿' : '已发布' }}
                </span>
              </td>
              <td class="ad-hint">{{ p.pages.map((pg) => pg.title).join('、') || '—' }}</td>
              <td class="ad-table__num ad-table__nowrap">{{ formatDateTime(p.date) }}</td>
              <td class="ad-table__num">{{ p.views }}</td>
              <td class="ad-table__num">{{ p.commentCount }}</td>
              <td>
                <div class="ad-table__actions">
                  <button class="ad-btn ad-btn--sm" type="button" :disabled="busyId === p.id" @click="toggleStatus(p)">
                    {{ p.status === 'published' ? '转为草稿' : '发布' }}
                  </button>
                  <NuxtLink class="ad-btn ad-btn--sm" :to="`/admin/posts/${p.id}`">编辑</NuxtLink>
                  <button class="ad-btn ad-btn--sm ad-btn--danger" type="button" :disabled="busyId === p.id" @click="remove(p)">
                    删除
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="ad-empty">
        没有匹配的文章。
        <button v-if="hasFilter" class="ad-btn ad-btn--sm" type="button" style="margin-left: 8px" @click="resetFilters">
          清除筛选
        </button>
      </p>
    </div>
  </div>
</template>
