<script setup lang="ts">
// 旧版孤儿页面的导航：与主站结构对齐（首页 / 动态 / 作品▾ / 关于）。
// 「作品」父项点击跳转，箭头按钮单独负责展开子菜单，触屏与键盘都可用；桌面同时保留悬浮展开。
const navItems = [
  { label: '首页', to: '/' },
  { label: '动态', to: '/category/news' },
  {
    label: '作品',
    to: '/category/works',
    children: [
      { label: '开发项目', to: '/category/project' },
      { label: '绘画作品', to: '/category/artwork' },
      { label: '中二日志', to: '/category/log' },
      { label: '学习笔记', to: '/category/notes' },
    ],
  },
  { label: '关于', to: '/personal' },
]

const openDir = ref<string | null>(null)
</script>

<template>
  <nav class="lg-nav" aria-label="站点导航">
    <template v-for="item in navItems" :key="item.label">
      <div
        v-if="item.children"
        class="lg-nav__dir"
        :class="{ 'is-open': openDir === item.label }"
        @mouseenter="openDir = item.label"
        @mouseleave="openDir = null"
      >
        <NuxtLink :to="item.to">{{ item.label }}</NuxtLink>
        <button
          class="lg-nav__caret-btn"
          type="button"
          :aria-expanded="openDir === item.label"
          :aria-label="`展开「${item.label}」子菜单`"
          @click="openDir = openDir === item.label ? null : item.label"
        >
          <span class="lg-nav__caret" aria-hidden="true">▾</span>
        </button>
        <div class="lg-nav__sub">
          <NuxtLink
            v-for="c in item.children"
            :key="c.to"
            :to="c.to"
            @click="openDir = null"
          >
            {{ c.label }}
          </NuxtLink>
        </div>
      </div>
      <NuxtLink v-else :to="item.to">{{ item.label }}</NuxtLink>
    </template>
  </nav>
</template>