<script setup lang="ts">
import { preloadRouteComponents } from '#app'
import { prefetchAdminData, prefetchAdminPath } from '~/composables/useAdmin'

const route = useRoute()
const router = useRouter()
const nuxtApp = useNuxtApp()
// 不再 await：会话只决定侧栏「退出登录」按钮的显隐，不该卡住整个后台首屏
const { data: session } = useAdminSession()

const items = [
  { label: '概览面板', to: '/admin' },
  { label: '页面', to: '/admin/pages' },
  { label: '文章', to: '/admin/posts' },
  { label: '评论', to: '/admin/comments' },
  { label: '媒体库', to: '/admin/media' },
  { label: '站点信息', to: '/admin/site' },
]

const isActive = (to: string) => (to === '/admin' ? route.path === '/admin' : route.path.startsWith(to))

async function logout() {
  await $fetch('/api/admin/session', { method: 'DELETE' })
  await navigateTo('/admin/login')
}

// 空闲预热：提前把各后台页的路由 chunk 与常用数据备好。
// 点导航时缓存已就绪、chunk 已加载，页面同步出内容，不再等一次接口往返（对照公共页 default.vue）。
onMounted(() => {
  const run = () => {
    for (const r of router.getRoutes()) {
      if (!r.path.startsWith('/admin') || r.path.includes('/login')) continue
      try {
        // 动态段（:id）用占位值替换，才能解析到路由并加载对应 chunk
        preloadRouteComponents(r.path.replace(/:[^/]+/g, '0'), router)
      } catch {
        // 个别路由解析失败不影响其它预热
      }
    }
    prefetchAdminData(nuxtApp)
  }
  // 别和首屏渲染抢资源：空闲时再下，兜底 3 秒
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(run, { timeout: 3000 })
  } else {
    window.setTimeout(run, 1500)
  }
})

useHead({ meta: [{ name: 'robots', content: 'noindex, nofollow' }] })
</script>

<template>
  <div class="admin">
    <aside class="admin__side">
      <div class="admin__brand">
        <strong>GarfieldGod</strong>
        <span>后台管理</span>
      </div>

      <nav class="admin__nav">
        <NuxtLink
          v-for="item in items"
          :key="item.to"
          :to="item.to"
          class="admin__nav-link"
          :class="{ 'is-active': isActive(item.to) }"
          @mouseenter="prefetchAdminPath(item.to, nuxtApp)"
          @focus="prefetchAdminPath(item.to, nuxtApp)"
        >
          {{ item.label }}
        </NuxtLink>
      </nav>

      <div class="admin__foot">
        <NuxtLink to="/" class="admin__ghost">查看站点</NuxtLink>
        <button v-if="session.authenticated && session.mode === 'password'" class="admin__ghost" type="button" @click="logout">
          退出登录
        </button>
      </div>
    </aside>

    <main class="admin__main">
      <slot />
    </main>
  </div>
</template>
