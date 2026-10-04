<script setup lang="ts">
const route = useRoute()
const { data: session } = await useAdminSession()

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
