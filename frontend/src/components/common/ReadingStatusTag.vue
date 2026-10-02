<script setup lang="ts">
import { computed } from 'vue'
import type { Instrument, Station } from '@/types'
import { READING_STATUS_LABELS, resolveReading } from '@/utils/instrument'

const props = defineProps<{
  station: Station
  instruments: Instrument[]
  size?: 'small' | 'default' | 'large'
}>()

const resolution = computed(() => resolveReading(props.station, props.instruments))
const tagType = computed(() => {
  if (resolution.value.effective) return 'success'
  if (props.station.readingStatus === 'pending') return 'warning'
  return 'info'
})
</script>

<template>
  <el-tooltip :content="resolution.reason" placement="top" :show-after="120">
    <el-tag :type="tagType" :size="size ?? 'small'" :effect="resolution.effective ? 'dark' : 'plain'">
      {{ READING_STATUS_LABELS[station.readingStatus] }} · {{ resolution.label }}
    </el-tag>
  </el-tooltip>
</template>
