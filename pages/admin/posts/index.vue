<script setup lang="ts">
import { prefetchAdminPost } from '~/composables/useAdmin'
import { sessionCachedData } from '~/composables/useSiteData'

definePageMeta({ layout: 'admin' })
useHead({ title: '文章 — GarfieldGod 后台' })

const nuxtApp = useNuxtApp()
const { data, refresh } = useFetch<{ posts: AdminPost[] }>('/api/admin/posts', {
  key: 'admin-posts',
  getCachedData: sessionCachedData,
})

const keyword = ref('')
const statusFilter = ref<'all' | 'published' | 'draft'>('all')
const pageFilter = ref<number | null>(null)
const tagFilter = ref<number | null>(null)
const busyId = ref<number | null>(null)
const message = ref('')

// 批量操作：勾选的文章 + 下拉菜单开合
const selectedIds = ref<number[]>([])
const menuOpen = ref(false)
const bulkBusy = ref(false)
const menuWrap = ref<HTMLElement | null>(null)

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

// ===== 批量选择 =====
const allPosts = computed(() => data.value?.posts ?? [])
const selectedPosts = computed(() => allPosts.value.filter((p) => selectedIds.value.includes(p.id)))
const allChecked = computed(
  () => posts.value.length > 0 && posts.value.every((p) => selectedIds.value.includes(p.id)),
)
const someChecked = computed(
  () => !allChecked.value && posts.value.some((p) => selectedIds.value.includes(p.id)),
)

function toggleAll() {
  if (allChecked.value) {
    const visible = new Set(posts.value.map((p) => p.id))
    selectedIds.value = selectedIds.value.filter((id) => !visible.has(id))
  } else {
    const set = new Set(selectedIds.value)
    for (const p of posts.value) set.add(p.id)
    selectedIds.value = [...set]
  }
}

// 筛选条件一变就清空选择，避免误操作到已经看不见的文章
watch([statusFilter, keyword, pageFilter, tagFilter], () => {
  selectedIds.value = []
})

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

// 后台的 PUT 是「整篇覆盖」：必须回传完整字段，漏掉谁就会把谁重置成默认值
// （样式方案、样式设置、正文宽度、留言开关）。批量操作也走这里。
function postPayload(post: AdminPost, overrides: Partial<PostPayload> = {}): PostPayload {
  return {
    title: post.title,
    date: post.date,
    content: post.content,
    excerpt: post.excerpt,
    featured: post.featured,
    pageIds: post.pages.map((p) => p.id),
    tagIds: post.tags.map((t) => t.id),
    status: post.status,
    format: post.format,
    contentWidth: post.contentWidth,
    postStyle: post.postStyle,
    postStyleOptions: post.postStyleOptions,
    allowComments: post.allowComments,
    bgmSrc: post.bgmSrc,
    ...overrides,
  }
}

async function toggleStatus(post: AdminPost) {
  busyId.value = post.id
  message.value = ''
  try {
    await $fetch(`/api/admin/posts/${post.id}`, {
      method: 'PUT',
      body: postPayload(post, { status: post.status === 'published' ? 'draft' : 'published' }),
    })
    await refresh()
  } catch (e) {
    message.value = adminError(e, '操作失败')
  } finally {
    busyId.value = null
  }
}

// ===== 批量操作 =====
function openBulkEdit() {
  menuOpen.value = false
  if (!selectedIds.value.length) return
  navigateTo(`/admin/posts/bulk?ids=${selectedIds.value.join(',')}`)
}

async function bulkToDraft() {
  menuOpen.value = false
  const targets = selectedPosts.value.filter((p) => p.status !== 'draft')
  if (!targets.length) {
    message.value = '所选文章都已是草稿。'
    return
  }
  if (!confirm(`确定把所选的 ${targets.length} 篇文章转为草稿？`)) return
  bulkBusy.value = true
  message.value = ''
  try {
    for (const p of targets) {
      await $fetch(`/api/admin/posts/${p.id}`, {
        method: 'PUT',
        body: postPayload(p, { status: 'draft' }),
      })
    }
    selectedIds.value = []
    await refresh()
    message.value = `已把 ${targets.length} 篇文章转为草稿。`
  } catch (e) {
    message.value = adminError(e, '操作失败')
  } finally {
    bulkBusy.value = false
  }
}

// 导出交给服务端打包：按每篇的 format 出 .md / .html，合成一个 zip 回传
async function bulkExport() {
  menuOpen.value = false
  const ids = selectedIds.value
  if (!ids.length) return
  bulkBusy.value = true
  message.value = '正在打包导出…'
  try {
    const blob = await $fetch<Blob>(`/api/admin/posts/export?ids=${ids.join(',')}`, {
      responseType: 'blob',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `garfieldgod-posts-${new Date().toISOString().slice(0, 10)}.zip`
    document.body.appendChild(a)
    a.click()
    a.remove()
    // 立刻 revoke 会让部分浏览器取消下载，留一点余量再回收
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    message.value = `已导出 ${ids.length} 篇文章。`
  } catch (e) {
    message.value = adminError(e, '导出失败')
  } finally {
    bulkBusy.value = false
  }
}

async function bulkRemove() {
  menuOpen.value = false
  const targets = selectedPosts.value
  if (!targets.length) return
  if (!confirm(`确定删除所选的 ${targets.length} 篇文章？评论与阅读数会一并删除，且不可恢复。`)) return
  bulkBusy.value = true
  message.value = ''
  try {
    for (const p of targets) {
      await $fetch(`/api/admin/posts/${p.id}`, { method: 'DELETE' })
    }
    selectedIds.value = []
    await refresh()
    message.value = `已删除 ${targets.length} 篇文章。`
  } catch (e) {
    message.value = adminError(e, '删除失败')
  } finally {
    bulkBusy.value = false
  }
}

// 点空白处收起下拉
function onDocClick(e: MouseEvent) {
  if (menuWrap.value && !menuWrap.value.contains(e.target as Node)) menuOpen.value = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
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
          <NuxtLink class="ad-btn ad-btn--sm ad-btn--primary" to="/admin/posts/import">批量导入</NuxtLink>
          <div ref="menuWrap" class="ad-menu">
            <button
              class="ad-btn ad-btn--sm"
              type="button"
              :disabled="!selectedIds.length || bulkBusy"
              @click="menuOpen = !menuOpen"
            >
              批量操作{{ selectedIds.length ? `（${selectedIds.length}）` : '' }} ▾
            </button>
            <div v-if="menuOpen" class="ad-menu__list">
              <button class="ad-menu__item" type="button" @click="openBulkEdit">编辑</button>
              <button class="ad-menu__item" type="button" @click="bulkToDraft">转为草稿</button>
              <button class="ad-menu__item" type="button" @click="bulkExport">导出</button>
              <button class="ad-menu__item is-danger" type="button" @click="bulkRemove">删除</button>
            </div>
          </div>
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
              <th class="ad-table__check">
                <input
                  type="checkbox"
                  :checked="allChecked"
                  :indeterminate.prop="someChecked"
                  :disabled="!posts.length"
                  title="全选本页"
                  @change="toggleAll"
                />
              </th>
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
            <tr
              v-for="p in posts"
              :key="p.id"
              @mouseenter="prefetchAdminPost(p.id, nuxtApp)"
            >
              <td class="ad-table__check">
                <input v-model="selectedIds" type="checkbox" :value="p.id" />
              </td>
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

<style scoped>
/* 勾选列：窄且居中，不抢标题的宽度 */
.ad-table__check {
  width: 36px;
  text-align: center;
}
.ad-table__check input {
  cursor: pointer;
}

/* 批量操作下拉 */
.ad-menu {
  position: relative;
  display: inline-block;
}
.ad-menu__list {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 20;
  min-width: 132px;
  padding: 6px;
  display: grid;
  gap: 2px;
  background: var(--gg-surface);
  border: 1px solid var(--gg-border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}
.ad-menu__item {
  padding: 8px 10px;
  border: none;
  border-radius: 6px;
  background: none;
  font: inherit;
  font-size: 0.9rem;
  color: var(--gg-ink);
  text-align: left;
  cursor: pointer;
}
.ad-menu__item:hover {
  background: var(--gg-surface-2);
}
.ad-menu__item.is-danger {
  color: #c0392b;
}
</style>
