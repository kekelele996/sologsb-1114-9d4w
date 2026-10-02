<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { ReadingStatus, Station } from '@/types'
import BearingInput from '@/components/common/BearingInput.vue'
import ClosureBadge from '@/components/common/ClosureBadge.vue'
import ReadingStatusTag from '@/components/common/ReadingStatusTag.vue'
import SegmentTag from '@/components/common/SegmentTag.vue'
import { useStore } from '@/hooks/usePersistentStore'
import { useClosureCheck } from '@/hooks/useClosureCheck'
import { instrumentStore } from '@/stores/instrumentStore'
import { segmentStore } from '@/stores/segmentStore'
import { stationStore } from '@/stores/stationStore'
import { caveStore } from '@/stores/caveStore'
import {
  computeHorizontal,
  computeVertical,
  formatDms,
  isValidBearing,
  isValidDip
} from '@/utils/survey'
import { effectiveStations, getExcludedReadings, READING_STATUS_LABELS, resolveReading } from '@/utils/instrument'
import { nextCode, uid } from '@/utils/id'

const caveState = useStore(caveStore)
const instrumentState = useStore(instrumentStore)
const segmentState = useStore(segmentStore)
const stationState = useStore(stationStore)

const selectedCaveId = ref<string>(caveState.caves[0]?.id ?? '')
const selectedSegmentId = ref<string>('')
const editingId = ref<string | null>(null)
const lastSaved = ref<string>('')

const form = reactive({
  code: 'P1',
  bearing: 90,
  dip: 0,
  slopeDistance: 10,
  instrumentNo: '',
  surveyor: '',
  date: new Date().toISOString().slice(0, 10),
  isClosurePoint: false,
  readingStatus: 'pending' as ReadingStatus,
  isResurvey: false,
  note: ''
})

const cavesWithSegments = computed(() => caveState.caves)
const segmentOptions = computed(() =>
  segmentState.segments.filter((segment) => !selectedCaveId.value || segment.caveId === selectedCaveId.value)
)
const currentSegment = computed(() => segmentState.segments.find((segment) => segment.id === selectedSegmentId.value))

const segmentStations = computed(() =>
  stationState.stations
    .filter((station) => station.segmentId === selectedSegmentId.value)
    .sort(
      (a, b) =>
        Number((a.code.match(/\d+/) ?? ['0'])[0]) - Number((b.code.match(/\d+/) ?? ['0'])[0]) ||
        a.date.localeCompare(b.date)
    )
)
const formalStations = computed(() => effectiveStations(segmentStations.value, instrumentState.instruments))
const excludedReadings = computed(() => getExcludedReadings(segmentStations.value, instrumentState.instruments))
const excludedAdopted = computed(() => excludedReadings.value.filter((item) => item.station.readingStatus === 'adopted'))

/** 已保存有效读数 + 当前待录入读数一起预演正式闭合差；待确认/留档/失效仪器读数不进成果 */
const pendingStation = computed<Station>(() => ({
  id: 'pending',
  segmentId: selectedSegmentId.value,
  code: form.code,
  bearing: form.bearing,
  dip: form.dip,
  slopeDistance: form.slopeDistance,
  horizontalDistance: previewHorizontal.value,
  verticalDistance: previewVertical.value,
  instrumentNo: form.instrumentNo,
  surveyor: form.surveyor,
  date: form.date,
  isClosurePoint: form.isClosurePoint,
  readingStatus: form.readingStatus,
  isResurvey: form.isResurvey,
  note: form.note
}))

const closureInput = computed<Station[]>(() => {
  const base = formalStations.value
  if (resolveReading(pendingStation.value, instrumentState.instruments).effective) return [...base, pendingStation.value]
  return base
})
const closureExcluded = computed(() => {
  const list = [...excludedReadings.value]
  const pendingResolution = resolveReading(pendingStation.value, instrumentState.instruments)
  if (!pendingResolution.effective) {
    list.push({ station: pendingStation.value, reason: `当前待保存读数：${pendingResolution.reason}` })
  }
  return list
})
const { result: closureResult, over: closureOver } = useClosureCheck(closureInput, 0.25, closureExcluded)

const previewHorizontal = computed(() => computeHorizontal(form.dip, form.slopeDistance))
const previewVertical = computed(() => computeVertical(form.dip, form.slopeDistance))
const currentInstrumentStatus = computed(() =>
  resolveReading(
    { ...pendingStation.value, readingStatus: 'adopted' },
    instrumentState.instruments
  ).instrumentStatus
)
const hasSameCode = computed(() =>
  segmentStations.value.some((station) => station.code.trim() === form.code.trim() && station.id !== editingId.value)
)

/** 异常读数：方位角或倾角超范围、斜距非正、水平距大于斜距；标定问题由读数状态列单独说明 */
function isAbnormal(station: Station): boolean {
  if (!isValidBearing(station.bearing)) return true
  if (!isValidDip(station.dip)) return true
  if (!(station.slopeDistance > 0)) return true
  return station.horizontalDistance > Math.abs(station.slopeDistance) + 0.001
}

function rowClassName(param: { row: Station }): string {
  const resolution = resolveReading(param.row, instrumentState.instruments)
  if (!resolution.effective) return 'excluded-row'
  return isAbnormal(param.row) ? 'abnormal-row' : ''
}

function refreshDefaultCode(): void {
  form.code = nextCode('P', segmentStations.value.map((station) => station.code))
}

function defaultInstrumentNo(): string {
  const today = new Date().toISOString().slice(0, 10)
  return (
    instrumentState.instruments.find((instrument) => !instrument.retired && getUsable(instrument, today))?.code ??
    instrumentState.instruments[0]?.code ??
    ''
  )
}

function getUsable(instrument: (typeof instrumentState.instruments)[number], date: string): boolean {
  // 小工具函数保持在本组件内，避免表单默认值循环依赖 resolveReading
  if (instrument.retired || instrument.calibrationResult !== '合格') return false
  return date >= instrument.calibrationDate && date <= instrument.validUntil
}

// IndexedDB 数据是异步水合的，洞穴/洞段到达后自动选中第一条，避免空选
watch(
  () => [caveState.caves.length, selectedCaveId.value] as const,
  () => {
    if (!selectedCaveId.value && caveState.caves.length > 0) {
      selectedCaveId.value = caveState.caves[0].id
    }
  },
  { immediate: true }
)

watch(
  () => [selectedCaveId.value, segmentOptions.value.length] as const,
  () => {
    const list = segmentOptions.value
    if (!list.some((segment) => segment.id === selectedSegmentId.value)) {
      selectedSegmentId.value = list.length > 0 ? list[0].id : ''
    }
  },
  { immediate: true }
)

watch(
  () => selectedSegmentId.value,
  () => {
    editingId.value = null
    resetForNewReading()
  },
  { immediate: true }
)

watch(
  () => [form.instrumentNo, form.date, instrumentState.instruments.length] as const,
  () => {
    if (editingId.value) return
    if (!form.instrumentNo) form.instrumentNo = defaultInstrumentNo()
    form.readingStatus = currentInstrumentStatus.value.usable ? 'adopted' : 'pending'
  }
)

function resetForNewReading(): void {
  editingId.value = null
  form.code = nextCode('P', segmentStations.value.map((station) => station.code))
  form.bearing = 90
  form.dip = 0
  form.slopeDistance = 10
  form.instrumentNo = defaultInstrumentNo()
  form.surveyor = ''
  form.date = new Date().toISOString().slice(0, 10)
  form.isClosurePoint = false
  form.readingStatus = currentInstrumentStatus.value.usable ? 'adopted' : 'pending'
  form.isResurvey = false
  form.note = ''
}

async function submit(continueNext: boolean): Promise<void> {
  if (!selectedSegmentId.value) {
    ElMessage.warning('请先选择洞段')
    return
  }
  if (!form.code.trim()) {
    ElMessage.warning('请填写测点桩号')
    return
  }
  if (!(form.slopeDistance > 0)) {
    ElMessage.warning('斜距必须大于 0')
    return
  }
  if (!isValidBearing(form.bearing)) {
    ElMessage.warning('前视方位角必须在 0°–360° 之间')
    return
  }
  if (!isValidDip(form.dip)) {
    ElMessage.warning('倾角必须在 -90°–90° 之间')
    return
  }
  if (!form.instrumentNo.trim()) {
    ElMessage.warning('请填写或选择仪器号；无档案读数会进入待确认')
    return
  }
  const existing = stationState.stations.find((station) => station.id === editingId.value)
  const station: Station = {
    id: existing?.id ?? uid('st'),
    segmentId: selectedSegmentId.value,
    code: form.code.trim(),
    bearing: form.bearing,
    dip: form.dip,
    slopeDistance: form.slopeDistance,
    horizontalDistance: previewHorizontal.value,
    verticalDistance: previewVertical.value,
    instrumentNo: form.instrumentNo.trim(),
    surveyor: form.surveyor.trim(),
    date: form.date,
    isClosurePoint: form.isClosurePoint,
    readingStatus: form.readingStatus,
    isResurvey: form.isResurvey,
    note: form.note.trim()
  }
  const wasAdopted = station.readingStatus === 'adopted'
  await stationStore.getState().save(station)
  const resolution = resolveReading(station, instrumentState.instruments)
  lastSaved.value = `${station.code} · ${READING_STATUS_LABELS[station.readingStatus]} · ${resolution.label}`
  if (resolution.effective) {
    ElMessage.success(`${station.code} 已进入正式成果`)
  } else if (wasAdopted) {
    ElMessage.warning(`${station.code} 的现场读数已保存，但仪器室判定不能进成果：${resolution.instrumentStatus.reason}`)
  } else {
    ElMessage.success(`${station.code} 现场读数已保存为「${READING_STATUS_LABELS[station.readingStatus]}」`)
  }
  if (continueNext) {
    await stationStore.getState().hydrate()
    resetForNewReading()
  } else {
    resetForNewReading()
  }
}

function editStation(station: Station): void {
  editingId.value = station.id
  form.code = station.code
  form.bearing = station.bearing
  form.dip = station.dip
  form.slopeDistance = station.slopeDistance
  form.instrumentNo = station.instrumentNo
  form.surveyor = station.surveyor
  form.date = station.date
  form.isClosurePoint = station.isClosurePoint
  form.readingStatus = station.readingStatus
  form.isResurvey = station.isResurvey
  form.note = station.note
}

function prepareResurvey(station: Station): void {
  editStation(station)
  editingId.value = null
  form.instrumentNo = defaultInstrumentNo()
  form.date = new Date().toISOString().slice(0, 10)
  form.readingStatus = currentInstrumentStatus.value.usable ? 'adopted' : 'pending'
  form.isResurvey = true
  form.note = `补测 ${station.code}，原读数仪器：${station.instrumentNo || '未填'}`
  ElMessage.info('已按原桩号准备补测；保存为“采用”后旧读数自动留档，原始记录不删除')
}

async function setStatus(station: Station, status: ReadingStatus): Promise<void> {
  await stationStore.getState().setReadingStatus(station.id, status)
  const resolution = resolveReading({ ...station, readingStatus: status }, instrumentState.instruments)
  ElMessage.success(`${station.code} 已由测量组设为「${READING_STATUS_LABELS[status]}」；正式判定：${resolution.label}`)
}

async function removeStation(station: Station): Promise<void> {
  await ElMessageBox.confirm(`确认删除测点「${station.code}」的这条现场读数？`, '删除确认', { type: 'warning' })
  await stationStore.getState().remove(station.id)
  ElMessage.success('现场读数已删除')
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">测点与读数录入</h2>
        <p class="page-sub">
          仪器是否合格听仪器室标定档案；测量组决定读数采用、留档或待确认。只有“采用 + 仪器有效”的读数进入闭合差、草图与图幅成果。
        </p>
      </div>
      <el-tag v-if="lastSaved" type="success" effect="plain">最近保存：{{ lastSaved }}</el-tag>
    </div>

    <div class="toolbar">
      <el-select v-model="selectedCaveId" placeholder="选择洞穴" style="width: 200px">
        <el-option v-for="cave in cavesWithSegments" :key="cave.id" :label="cave.name" :value="cave.id" />
      </el-select>
      <el-select v-model="selectedSegmentId" placeholder="选择洞段" style="width: 220px">
        <el-option
          v-for="segment in segmentOptions"
          :key="segment.id"
          :label="`${segment.code}（${segment.startStake} → ${segment.endStake}）`"
          :value="segment.id"
        />
      </el-select>
      <SegmentTag v-if="currentSegment" :type="currentSegment.type" :closed="currentSegment.closed" size="small" />
      <el-button :disabled="!selectedSegmentId" @click="refreshDefaultCode">重算下一桩号</el-button>
      <el-tag effect="plain">现场读数 {{ segmentStations.length }} 条</el-tag>
      <el-tag type="success" effect="plain">正式有效 {{ formalStations.length }} 条</el-tag>
      <el-tag v-if="excludedReadings.length" type="warning" effect="plain">排除 {{ excludedReadings.length }} 条</el-tag>
    </div>

    <el-card shadow="never" class="form-card">
      <el-form label-width="96px">
        <el-row :gutter="16">
          <el-col :span="6">
            <el-form-item label="测点桩号" required>
              <el-input v-model="form.code" placeholder="如 P12" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="前视方位角">
              <BearingInput v-model="form.bearing" kind="bearing" @invalid="(msg: string) => ElMessage.warning(msg)" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="倾角">
              <BearingInput v-model="form.dip" kind="dip" @invalid="(msg: string) => ElMessage.warning(msg)" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="斜距(m)" required>
              <el-input-number v-model="form.slopeDistance" :min="0" :step="0.1" :precision="3" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="6">
            <el-form-item label="仪器号">
              <el-select
                v-model="form.instrumentNo"
                filterable
                allow-create
                default-first-option
                placeholder="选择或输入仪器号"
                style="width: 100%"
              >
                <el-option
                  v-for="instrument in instrumentState.instruments"
                  :key="instrument.id"
                  :label="`${instrument.code}（${instrument.retired ? '停用' : instrument.calibrationResult}）`"
                  :value="instrument.code"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="测量人">
              <el-input v-model="form.surveyor" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="测量日期">
              <el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="闭合点">
              <el-switch v-model="form.isClosurePoint" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="读数用途">
              <el-radio-group v-model="form.readingStatus">
                <el-radio-button label="adopted">采用</el-radio-button>
                <el-radio-button label="archived">留档</el-radio-button>
                <el-radio-button label="pending">待确认</el-radio-button>
              </el-radio-group>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="补测读数">
              <el-switch v-model="form.isResurvey" />
            </el-form-item>
          </el-col>
          <el-col :span="10">
            <el-form-item label="仪器室判定">
              <el-tag :type="currentInstrumentStatus.usable ? 'success' : 'danger'" effect="plain">
                {{ currentInstrumentStatus.label }}：{{ currentInstrumentStatus.reason }}
              </el-tag>
              <el-tag v-if="hasSameCode" type="warning" effect="plain" style="margin-left: 8px">
                同桩号已有读数，保存“采用”后其余自动留档
              </el-tag>
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="备注">
          <el-input v-model="form.note" type="textarea" :rows="2" placeholder="岩壁、滴水、崩塌堆积、补测原因等现场情况" />
        </el-form-item>
        <div class="preview">
          <el-tag effect="plain">自动推算：水平距 {{ previewHorizontal.toFixed(3) }} m</el-tag>
          <el-tag effect="plain">垂距 {{ previewVertical.toFixed(3) }} m</el-tag>
          <el-tag effect="plain">方位角 {{ formatDms(form.bearing) }}</el-tag>
          <el-tag effect="plain">倾角 {{ formatDms(form.dip) }}</el-tag>
        </div>
        <div class="actions">
          <el-button type="primary" @click="submit(false)">{{ editingId ? '保存修改' : '保存测点' }}</el-button>
          <el-button type="success" plain @click="submit(true)">保存并录入下一站</el-button>
          <el-button @click="resetForNewReading">{{ editingId ? '取消编辑/新增' : '清空' }}</el-button>
        </div>
      </el-form>
    </el-card>

    <ClosureBadge
      class="closure"
      :closure="closureResult.closure"
      :threshold="closureResult.threshold"
      :level="closureResult.level"
      :detail="closureResult.detail"
      :count="closureResult.count"
    />
    <el-alert
      v-if="excludedReadings.length"
      class="alert"
      :type="excludedAdopted.length ? 'error' : 'info'"
      :closable="false"
      :title="`${excludedReadings.length} 条现场读数未进入正式成果`"
    >
      <template #default>
        <div v-for="item in excludedReadings" :key="item.station.id" class="excluded-line">
          {{ item.station.code }} / {{ item.station.instrumentNo || '未填仪器号' }}：{{ item.reason }}
        </div>
      </template>
    </el-alert>
    <el-alert
      v-if="closureOver"
      class="alert"
      type="error"
      :closable="false"
      title="有效读数闭合差已超限"
      description="当前正式成果仅按有效读数累计；建议对异常或停用仪器测点补测。"
    />

    <h3 class="section-title">本洞段现场读数（{{ formalStations.length }}/{{ segmentStations.length }} 条有效）</h3>
    <el-table :data="segmentStations" border stripe :row-class-name="rowClassName">
      <el-table-column prop="code" label="桩号" width="90" />
      <el-table-column label="方位角" width="150">
        <template #default="{ row }: { row: Station }">{{ row.bearing }}° / {{ formatDms(row.bearing) }}</template>
      </el-table-column>
      <el-table-column label="倾角" width="140">
        <template #default="{ row }: { row: Station }">{{ row.dip }}°</template>
      </el-table-column>
      <el-table-column prop="slopeDistance" label="斜距(m)" width="100" />
      <el-table-column prop="horizontalDistance" label="水平距(m)" width="110" />
      <el-table-column prop="verticalDistance" label="垂距(m)" width="100" />
      <el-table-column label="仪器号" width="130">
        <template #default="{ row }: { row: Station }">
          {{ row.instrumentNo || '未填' }}
          <el-tag v-if="row.isResurvey" type="warning" size="small" effect="plain">补测</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="surveyor" label="测量人" width="90" />
      <el-table-column prop="date" label="日期" width="120" />
      <el-table-column label="闭合点" width="90">
        <template #default="{ row }: { row: Station }">
          <el-tag v-if="row.isClosurePoint" type="success" size="small" effect="plain">是</el-tag>
          <span v-else class="muted">—</span>
        </template>
      </el-table-column>
      <el-table-column label="读数/仪器判定" min-width="190">
        <template #default="{ row }: { row: Station }">
          <ReadingStatusTag :station="row" :instruments="instrumentState.instruments" />
          <div v-if="!resolveReading(row, instrumentState.instruments).effective" class="excluded-reason">
            {{ resolveReading(row, instrumentState.instruments).reason }}
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="note" label="备注" min-width="140" show-overflow-tooltip />
      <el-table-column label="操作" width="230" fixed="right">
        <template #default="{ row }: { row: Station }">
          <el-button link type="primary" size="small" @click="editStation(row)">编辑</el-button>
          <el-button link type="warning" size="small" @click="prepareResurvey(row)">补测</el-button>
          <el-button
            link
            :type="row.readingStatus === 'adopted' ? 'default' : 'success'"
            size="small"
            @click="setStatus(row, 'adopted')"
          >
            采用
          </el-button>
          <el-button link type="info" size="small" @click="setStatus(row, 'archived')">留档</el-button>
          <el-button link type="danger" size="small" @click="removeStation(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.form-card {
  border-radius: 12px;
  margin-bottom: 16px;
}
.preview {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 0 0 96px;
}
.actions {
  display: flex;
  gap: 10px;
  padding: 14px 0 0 96px;
}
.closure {
  margin-bottom: 12px;
}
.alert {
  margin-bottom: 12px;
}
.excluded-line {
  font-size: 12px;
  line-height: 1.7;
}
.excluded-reason {
  margin-top: 4px;
  font-size: 12px;
  color: #9a6a00;
  line-height: 1.5;
}
:deep(.abnormal-row) {
  background: #fdf2f2 !important;
}
:deep(.abnormal-row td) {
  color: #b03030;
}
:deep(.excluded-row) {
  background: #f7f7f8 !important;
}
:deep(.excluded-row td) {
  color: #7a8896;
}
</style>
