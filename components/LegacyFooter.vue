<script setup lang="ts">
// 旧版首页的页脚：左「了解更多」、右品牌名、下方社交图标。
// variant 决定配色：dark 用于纯黑页面（搜索页），light 用于浅色内容区（旧版首页/移动版）。
withDefaults(defineProps<{ variant?: 'dark' | 'light' }>(), { variant: 'dark' })

const socials = [
  { label: 'Steam', href: 'https://steamcommunity.com/profiles/76561198239055708', icon: '/legacy/steam.png' },
  { label: '哔哩哔哩', href: 'https://space.bilibili.com/12008567', icon: '/legacy/bilibili.png' },
  { label: 'QQ空间', href: 'https://user.qzone.qq.com/1351763110', icon: '/legacy/qqzone.png' },
]
</script>

<template>
  <footer class="lgfoot" :class="`lgfoot--${variant}`">
    <div class="lgfoot__inner">
      <div class="lgfoot__row">
        <span class="lgfoot__more">了解更多</span>
        <a class="lgfoot__brand" href="https://garfieldgod.cn">GarfieldGod</a>
      </div>
      <ul class="lgfoot__socials">
        <li v-for="s in socials" :key="s.label">
          <a :href="s.href" target="_blank" rel="noopener" :aria-label="s.label">
            <img :src="s.icon" :alt="s.label">
          </a>
        </li>
      </ul>
    </div>
  </footer>
</template>

<style scoped>
.lgfoot {
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  padding: 28px 0 40px;
}
.lgfoot__inner {
  width: min(920px, 92vw);
  margin: 0 auto;
}
.lgfoot__row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
}
.lgfoot__more {
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.95rem;
}
.lgfoot__brand {
  color: #fff;
  font-style: italic;
  text-decoration: none;
}
.lgfoot__brand:hover {
  color: #a9fff9;
}
.lgfoot__socials {
  display: flex;
  gap: 14px;
  margin: 18px 0 0;
  padding: 0;
  list-style: none;
}
.lgfoot__socials img {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  object-fit: cover;
  opacity: 0.85;
  transition: opacity 0.2s, transform 0.2s;
}
.lgfoot__socials a:hover img {
  opacity: 1;
  transform: translateY(-2px);
}

/* 浅色内容区上的配色：分割线与文字转为深色 */
.lgfoot--light { border-top-color: rgba(0, 0, 0, 0.12); }
.lgfoot--light .lgfoot__more { color: #6d6d6d; }
.lgfoot--light .lgfoot__brand { color: #141414; }
.lgfoot--light .lgfoot__brand:hover { color: #0a7c82; }
</style>