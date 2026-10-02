import { computed, type Ref } from 'vue'
import type { ClosureResult, ExcludedReading, Station } from '@/types'
import { computeClosure } from '@/utils/survey'

/**
 * 输入正式采用且仪器有效的测点序列，返回闭合差与误差等级。
 * @param stations 有效测点序列（响应式）
 * @param threshold 闭合差阈值（米）
 * @param excluded 被排除出正式成果的读数说明（响应式）
 */
export function useClosureCheck(
  stations: Ref<Station[]>,
  threshold = 0.25,
  excluded?: Ref<ExcludedReading[]>
): {
  closure: Ref<number>
  result: Ref<ClosureResult>
  over: Ref<boolean>
  level: Ref<ClosureResult['level']>
} {
  const result = computed<ClosureResult>(() => computeClosure(stations.value, threshold, excluded?.value ?? []))
  const closure = computed(() => result.value.closure)
  const over = computed(() => result.value.over)
  const level = computed(() => result.value.level)
  return { closure, result, over, level }
}
