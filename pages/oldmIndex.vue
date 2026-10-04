<script setup lang="ts">
// 孤儿页面：/oldmIndex（由原 garfieldgod.github.io 的 mindex.html 现代化而来）。
// 原页是手机版首页，这里做成窄栏移动布局：桌面端居中成一条手机宽的内容带，窄屏自动铺满。
import '~/assets/css/legacy.css'

definePageMeta({ layout: false })
useHead({ title: 'GarfieldGod — 神加菲尔德（移动版）' })

const collapsed = ref(false)
const viewerOpen = ref(false)
const mainRef = ref<HTMLElement | null>(null)

async function toggleCover() {
  collapsed.value = !collapsed.value
  if (collapsed.value) {
    await nextTick()
    mainRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}
</script>

<template>
  <div class="lg lg--mobile">
    <div class="lg-shell">
      <section
        class="lg-cover"
        :class="{ 'is-collapsed': collapsed }"
        role="button"
        tabindex="0"
        :aria-expanded="collapsed"
        aria-label="展开或收起封面"
        @click="toggleCover"
        @keydown.enter.prevent="toggleCover"
        @keydown.space.prevent="toggleCover"
      >
        <img class="lg-cover__img" src="/legacy/index-cover.jpg" alt="">
        <p class="lg-cover__hint">欢迎访问GarfieldGod的主页</p>
        <span class="lg-cover__cue" aria-hidden="true">❯</span>
      </section>

      <header class="lg-head">
        <div class="lg-head__inner">
          <button class="lg-avatar" type="button" aria-label="查看头像" @click="viewerOpen = true">
            <img src="/legacy/avatar.jpg" alt="GarfieldGod 头像">
          </button>
          <div class="lg-id">
            <h1 class="lg-id__name">GarfieldGod</h1>
            <p class="lg-id__line">I'm God.</p>
            <a class="lg-id__link" href="https://garfieldgod.cn">garfieldgod.cn</a>
          </div>

          <LegacyNav />
        </div>
      </header>

      <Transition name="lg-reveal">
        <main v-show="collapsed" ref="mainRef" class="lg-main">
          <section class="lg-content">
            <div class="lg-content__inner">
              <h2 class="lg-content__title">最新事项</h2>
              <NuxtLink class="lg-card" to="/post/1">
                <h3 class="lg-card__title">世界，您好！</h3>
                <div class="lg-card__img">
                  <img src="/legacy/hello-world.jpg" alt="世界，您好！">
                </div>
                <div class="lg-card__body">
                  <p>欢迎访问GarfieldGod的主页！</p>
                  <div class="lg-card__meta">
                    <span>GarfieldGod</span>
                    <span>2023年6月5日</span>
                  </div>
                </div>
              </NuxtLink>
            </div>
          </section>

          <div class="lg-footzone">
            <LegacyFooter variant="light" />
          </div>
        </main>
      </Transition>
    </div>

    <LegacyAvatarViewer :images="['/legacy/avatar-pro.jpg']" :open="viewerOpen" @close="viewerOpen = false" />
  </div>
</template>