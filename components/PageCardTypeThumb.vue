<script setup lang="ts">
// 条目类型的缩略示意图：只画卡片的骨架形态，供后台「条目类型」选择器使用。
defineProps<{ type: string }>()
</script>

<template>
  <svg class="ct-thumb" viewBox="0 0 100 52" aria-hidden="true">
    <template v-if="type === 'standard'">
      <rect x="10" y="6" width="80" height="24" rx="4" fill="#c9c9c9" />
      <rect x="10" y="35" width="52" height="6" rx="3" fill="#3b3b3b" />
      <rect x="10" y="45" width="72" height="4" rx="2" fill="#d5d5d5" />
    </template>

    <template v-else-if="type === 'overlay'">
      <defs>
        <linearGradient id="ct-overlay" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#c9c9c9" />
          <stop offset="1" stop-color="#141414" />
        </linearGradient>
      </defs>
      <rect x="8" y="5" width="84" height="42" rx="5" fill="url(#ct-overlay)" />
      <rect x="14" y="34" width="46" height="6" rx="3" fill="rgba(255,255,255,.92)" />
      <rect x="14" y="43" width="30" height="4" rx="2" fill="rgba(255,255,255,.6)" />
    </template>

    <template v-else-if="type === 'horizontal'">
      <rect x="8" y="10" width="34" height="32" rx="4" fill="#c9c9c9" />
      <rect x="48" y="14" width="44" height="6" rx="3" fill="#3b3b3b" />
      <rect x="48" y="25" width="36" height="4" rx="2" fill="#d5d5d5" />
      <rect x="48" y="33" width="40" height="4" rx="2" fill="#d5d5d5" />
    </template>

    <template v-else-if="type === 'editorial'">
      <rect x="8" y="18" width="26" height="6" rx="3" fill="#3b3b3b" />
      <rect x="8" y="28" width="16" height="4" rx="2" fill="#c0c0c0" />
      <rect x="42" y="17" width="50" height="6" rx="3" fill="#3b3b3b" />
      <rect x="42" y="28" width="42" height="4" rx="2" fill="#d5d5d5" />
    </template>

    <template v-else>
      <rect x="8" y="6" width="40" height="40" rx="5" fill="#fff" stroke="#e2e2e2" />
      <rect x="8" y="6" width="40" height="22" rx="5" fill="#c9c9c9" />
      <rect x="13" y="34" width="24" height="5" rx="2" fill="#3b3b3b" />
      <rect x="52" y="6" width="40" height="40" rx="5" fill="#fff" stroke="#e2e2e2" />
      <rect x="52" y="6" width="40" height="22" rx="5" fill="#d8d8d8" />
      <rect x="57" y="34" width="20" height="5" rx="2" fill="#3b3b3b" />
    </template>
  </svg>
</template>