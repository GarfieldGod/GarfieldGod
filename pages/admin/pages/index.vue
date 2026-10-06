<script setup lang="ts">
import { prefetchAdminNavPage } from '~/composables/useAdmin'
import { sessionCachedData } from '~/composables/useSiteData'

definePageMeta({ layout: 'admin' })
useHead({ title: '页面 — GarfieldGod 后台' })

const nuxtApp = useNuxtApp()
const { data, refresh } = useFetch<{ pages: AdminNavPage[] }>('/api/admin/nav-pages', {
  key: 'admin-nav-pages',
  getCachedData: sessionCachedData,
})

const busyId = ref<number | null>(null)
const message = ref('')

const pageName = computed(() =>
  Object.fromEntries((data.value?.pages ?? []).map((p) => [p.id, p.title])),
)

// 平铺列表按 parent_id 建树，DFS 展开成带缩进的行，保证子页面紧跟父页面
const rows = computed(() => {
  const byParent = new Map<number, AdminNavPage[]>()
  for (const p of data.value?.pages ?? []) {
    const list = byParent.get(p.parentId) ?? []
    list.push(p)
    byParent.set(p.parentId, list)
  }
  for (const list of byParent.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)

  const out: { page: AdminNavPage; depth: number }[] = []
  const walk = (parentId: number, depth: number) => {
    for (const page of byParent.get(parentId) ?? []) {
      out.push({ page, depth })
      walk(page.id, depth + 1)
    }
  }
  walk(0, 0)
  return out
})

// 只有「条目项」会铺文章条目（首页由独立模板铺「最新事项」），
// 静态文本、子页面 都不铺条目，「内容来源」对它们不适用。
function showsItems(page: AdminNavPage): boolean {
  return page.isHome || page.layout === 'items'
}

function sourceSummary(page: AdminNavPage): string {
  switch (page.contentSource) {
    case 'posts':
      return page.postCount ? `收录 ${page.postCount} 篇` : '暂无文章'
    case 'aggregate':
      return page.aggregatePages.length
        ? `聚合：${page.aggregatePages.map((id) => pageName.value[id] ?? id).join('、')}`
        : '未选择聚合页面'
    case 'latest':
      return page.latestLimit > 0 ? `最新 ${page.latestLimit} 篇` : '全部最新文章'
    default:
      return '—'
  }
}

// 不铺条目的展示类型，在「内容来源」列给出它真正在渲染什么
function layoutSummary(page: AdminNavPage): string {
  if (page.layout === 'static') return '静态正文'
  if (page.layout === 'children') return `子页面 ${page.childCount} 个`
  return '不铺条目'
}

async function remove(page: AdminNavPage) {
  if (!confirm(`确定删除页面「${page.title}」？该页面路径将立即失效，且不可恢复。`)) return
  busyId.value = page.id
  message.value = ''
  try {
    await $fetch(`/api/admin/nav-pages/${page.id}`, { method: 'DELETE' })
    await refresh()
    message.value = '已删除。'
  } catch (e) {
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
        <h1 class="ad-title">页面</h1>
        <p class="ad-sub">
          共 {{ data?.pages.length ?? 0 }} 个页面
        </p>
      </div>
      <div class="ad-actions">
        <NuxtLink class="ad-btn ad-btn--primary" to="/admin/pages/new">新建页面</NuxtLink>
      </div>
    </div>

    <p v-if="message" class="ad-msg" :class="message.includes('失败') ? 'is-error' : 'is-ok'">{{ message }}</p>

    <section class="ad-card">
      <div class="ad-card__head">
        <h2 class="ad-card__title">页面结构</h2>
      </div>

      <div v-if="rows.length" class="ad-scroll">
        <table class="ad-table">
          <thead>
            <tr>
              <th>页面</th>
              <th>展示</th>
              <th>内容来源</th>
              <th class="ad-table__nowrap">条目</th>
              <th class="ad-table__nowrap">导航</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.page.id">
              <td>
                <div class="pg-name" :style="{ paddingLeft: `${row.depth * 20}px` }">
                  <span v-if="row.depth" class="pg-branch">└</span>
                  <NuxtLink
                    class="ad-table__title"
                    :to="`/admin/pages/${row.page.id}`"
                    @mouseenter="prefetchAdminNavPage(row.page.id, nuxtApp)"
                    @focus="prefetchAdminNavPage(row.page.id, nuxtApp)"
                  >
                    {{ row.page.title }}
                  </NuxtLink>
                  <span v-if="row.page.isHome" class="ad-badge">首页</span>
                  <span v-if="row.page.reserved && !row.page.isHome" class="ad-badge">保留</span>
                </div>
                <div class="ad-hint pg-path">
                  {{ row.page.isHome ? '/' : `/${row.page.slug}` }}
                  <template v-if="row.page.postCount"> · {{ row.page.postCount }} 篇</template>
                </div>
              </td>
              <td>
                {{ LAYOUT_LABELS[row.page.layout] ?? row.page.layout }}
              </td>
              <td>
                <template v-if="showsItems(row.page)">
                  {{ CONTENT_SOURCE_LABELS[row.page.contentSource] ?? row.page.contentSource }}
                  <div class="ad-hint">{{ sourceSummary(row.page) }}</div>
                </template>
                <template v-else>
                  <span class="ad-hint">{{ layoutSummary(row.page) }}</span>
                </template>
              </td>
              <td class="ad-table__nowrap">
                <template v-if="showsItems(row.page)">
                  {{ CARD_TYPE_LABELS[row.page.cardType] ?? row.page.cardType }}
                  <div class="ad-hint">
                    {{ row.page.columns === 1 ? '单列' : `${row.page.columns} 列` }}
                    <template v-if="!row.page.isHome"> · 每页 {{ row.page.pageSize }}</template>
                  </div>
                  <div v-if="row.page.tagFilter" class="ad-hint">标签筛选</div>
                </template>
                <span v-else class="ad-hint">—</span>
              </td>
              <td class="ad-table__nowrap">
                <span class="ad-badge" :class="row.page.navVisible ? 'is-published' : 'is-hidden'">
                  {{ row.page.navVisible ? '显示' : '隐藏' }}
                </span>
              </td>
              <td>
                <div class="ad-table__actions">
                  <NuxtLink class="ad-btn ad-btn--sm" :to="`/admin/pages/${row.page.id}`">编辑</NuxtLink>
                  <button
                    v-if="!row.page.reserved && !row.page.isHome"
                    class="ad-btn ad-btn--sm ad-btn--danger"
                    type="button"
                    :disabled="busyId === row.page.id"
                    @click="remove(row.page)"
                  >
                    删除
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="ad-empty">还没有页面。</p>
    </section>

    <section class="ad-card">
      <h2 class="ad-card__title">删除保护</h2>
      <ul class="pg-notes">
        <li>保留页不可删除。</li>
        <li>页面下还有子页面或文章时不能删除，请先移走或删除它们。</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.pg-name { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pg-branch { color: var(--gg-muted); font-family: monospace; }
.pg-path { margin-top: 3px; font-variant-numeric: tabular-nums; }
.pg-notes { margin: 12px 0 0; padding-left: 18px; color: var(--gg-inksoft); font-size: 0.88rem; line-height: 1.9; }
</style>