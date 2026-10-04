<script setup lang="ts">
definePageMeta({ layout: false })
useHead({ title: '后台登录 — GarfieldGod', meta: [{ name: 'robots', content: 'noindex, nofollow' }] })

const route = useRoute()
const { data: session } = await useAdminSession()

const password = ref('')
const error = ref('')
const submitting = ref(false)

const next = computed(() => (typeof route.query.next === 'string' ? route.query.next : '/admin'))

async function submit() {
  error.value = ''
  submitting.value = true
  try {
    await $fetch('/api/admin/session', { method: 'POST', body: { password: password.value } })
    await navigateTo(next.value)
  } catch (e) {
    error.value = adminError(e, '登录失败')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="ad-login">
    <div class="ad-login__card">
      <h1 class="ad-login__title">后台管理</h1>
      <p class="ad-login__sub">GarfieldGod</p>

      <form v-if="session.mode === 'password'" @submit.prevent="submit">
        <label class="ad-field">
          <span class="ad-label">管理口令</span>
          <input v-model="password" class="ad-input" type="password" autocomplete="current-password" required />
        </label>
        <p v-if="error" class="ad-msg is-error">{{ error }}</p>
        <button class="ad-btn ad-btn--primary" type="submit" :disabled="submitting" style="margin-top: 16px; width: 100%; justify-content: center">
          {{ submitting ? '验证中…' : '进入后台' }}
        </button>
      </form>

      <div v-else>
        <p class="ad-hint">
          <template v-if="session.mode === 'dev'">
            当前为开发环境，后台未设访问控制。生产环境请设置 GG_ADMIN_PASSWORD，或接入 Cloudflare Access。
          </template>
          <template v-else-if="session.mode === 'access'">
            后台已交由 Cloudflare Access 保护。若你看到这个页面，说明 Access 未放行当前请求。
          </template>
          <template v-else>
            后台未启用访问控制：请设置环境变量 GG_ADMIN_PASSWORD，或接入 Cloudflare Access 后设置 GG_TRUST_ACCESS=1。
          </template>
        </p>
        <NuxtLink v-if="session.mode === 'dev'" class="ad-btn" to="/admin" style="margin-top: 16px">进入后台</NuxtLink>
      </div>
    </div>
  </div>
</template>
