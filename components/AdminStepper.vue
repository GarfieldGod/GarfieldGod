<script setup lang="ts">
// 后台数字步进器：− / + 微调，中间可直接键入；数值在 [min, max] 内取整。
const props = withDefaults(
  defineProps<{ modelValue: number; min?: number; max?: number; step?: number }>(),
  { min: 0, max: 9999, step: 1 },
)
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

function clamp(n: number) {
  const v = Math.round(Number(n))
  return Math.min(Math.max(Number.isFinite(v) ? v : props.min, props.min), props.max)
}
</script>

<template>
  <div class="ad-step">
    <button
      type="button"
      class="ad-step__btn"
      :disabled="modelValue <= min"
      @click="emit('update:modelValue', clamp(modelValue - step))"
    >
      −
    </button>
    <input
      class="ad-step__input"
      type="number"
      :value="modelValue"
      :min="min"
      :max="max"
      @change="emit('update:modelValue', clamp(Number(($event.target as HTMLInputElement).value)))"
    />
    <button
      type="button"
      class="ad-step__btn"
      :disabled="modelValue >= max"
      @click="emit('update:modelValue', clamp(modelValue + step))"
    >
      +
    </button>
  </div>
</template>

<style scoped>
.ad-step {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--gg-border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--gg-surface);
}
.ad-step__btn {
  width: 34px;
  height: 36px;
  border: 0;
  background: var(--gg-surface-2);
  color: var(--gg-ink);
  font: inherit;
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s;
}
.ad-step__btn:hover:not(:disabled) { background: var(--gg-border); }
.ad-step__btn:disabled { color: var(--gg-muted); cursor: default; }
.ad-step__input {
  width: 62px;
  height: 36px;
  border: 0;
  border-left: 1px solid var(--gg-border);
  border-right: 1px solid var(--gg-border);
  background: var(--gg-surface);
  color: var(--gg-ink);
  font: inherit;
  font-size: 0.92rem;
  text-align: center;
  font-variant-numeric: tabular-nums;
  -moz-appearance: textfield;
}
.ad-step__input::-webkit-outer-spin-button,
.ad-step__input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.ad-step__input:focus { outline: none; box-shadow: inset 0 0 0 2px var(--gg-ink); }
</style>