<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CALIBRATION_RESULTS, type CalibrationResult, type Instrument, type Station } from '@/types'
import { useStore } from '@/hooks/usePersistentStore'
import { instrumentStore } from '@/stores/instrumentStore'
import { stationStore } from '@/stores/stationStore'
import { segmentStore } from '@/stores/segmentStore'
import { READING_STATUS_LABELS, findInstrument, getInstrumentStatus } from '@/utils/instrument'
import { reconcileByInstrument, type ReconcileGroup } from '@/utils/reconcile'
import { uid } from '@/utils/id'

const instrumentState = useStore(instrumentStore)
const stationState = useStore(stationStore)
const segmentState = useStore(segmentStore)

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const retryKeys = ref<string[]>([])
const retryNote = ref('')

const form = reactive({
  code: '',
  name: '',
  calibrationDate: new Date().toISOString().slice(0, 10),
  validUntil: '',
  calibrationResult: '合格' as CalibrationResult,
  retired: false,
  note: ''
})

function oneYearLater(date: string): string {
  const value = new Date(date)
  if (Number.isNaN(value.getTime())) return ''
  value.setFullYear(value.getFullYear() + 1)
  return value.toISOString().slice(0, 10)
}

const instrumentGroups = computed<ReconcileGroup[]>(() =>
  reconcileByInstrument(stationState.stations, instrumentState.instruments)
)
const failedGroups = computed(() => instrumentGroups.value.filter((group) => !group.ok))
const retriedGroups = computed(() => instrumentGroups.value.filter((group) => retryKeys.value.includes(group.key)))
const activeInstrumentCount = computed(() => instrumentState.instruments.filter((instrument) => instrumentStatus(instrument).usable).length)
const excludedCount = computed(
  () =>
    stationState.stations.filter((station) => station.readingStatus !== 'archived').length -
    instrumentGroups.value.reduce((sum, group) => sum + group.effective, 0)
)

function instrumentStatus(instrument: Instrument) {
  const today = new Date().toISOString().slice(0, 10)
  return getInstrumentStatus(instrument, today)
}

function readingCount(instrumentNo: string): number {
  return stationState.stations.filter((station) => station.instrumentNo.trim() === instrumentNo.trim()).length
}

function resetForm(): void {
  editingId.value = null
  form.code = `INS-${String(instrumentState.instruments.length + 1).padStart(2, '0')}`
  form.name = ''
  form.calibrationDate = new Date().toISOString().slice(0, 10)
  form.validUntil = oneYearLater(form.calibrationDate)
  form.calibrationResult = '合格'
  form.retired = false
  form.note = ''
}

function openCreate(prefillCode?: string): void {
  resetForm()
  if (prefillCode) form.code = prefillCode
  dialogVisible.value = true
}

function openEdit(instrument: Instrument): void {
  editingId.value = instrument.id
  form.code = instrument.code
  form.name = instrument.name
  form.calibrationDate = instrument.calibrationDate
  form.validUntil = instrument.validUntil
  form.calibrationResult = instrument.calibrationResult
  form.retired = instrument.retired
  form.note = instrument.note
  dialogVisible.value = true
}

async function submit(): Promise<void> {
  if (!form.code.trim()) {
    ElMessage.warning('请填写仪器号')
    return
  }
  if (!form.calibrationDate || !form.validUntil) {
    ElMessage.warning('请填写标定日期与有效期')
    return
  }
  if (form.validUntil < form.calibrationDate) {
    ElMessage.warning('有效期不能早于标定日期')
    return
  }
  const duplicate = instrumentState.instruments.find(
    (instrument) =>
      instrument.code.trim().toLowerCase() === form.code.trim().toLowerCase() && instrument.id !== editingId.value
  )
  if (duplicate) {
    ElMessage.warning('该仪器号已存在，标定档案必须一仪一档')
    return
  }
  const existing = instrumentState.instruments.find((instrument) => instrument.id === editingId.value)
  const instrument: Instrument = {
    id: existing?.id ?? uid('ins'),
    code: form.code.trim(),
    name: form.name.trim(),
    calibrationDate: form.calibrationDate,
    validUntil: form.validUntil,
    calibrationResult: form.calibrationResult,
    retired: form.retired,
    note: form.note.trim()
  }
  await instrumentStore.getState().save(instrument)
  dialogVisible.value = false
  ElMessage.success(existing ? '仪器标定档案已更新' : '仪器标定档案已建立')
}

async function toggleRetired(instrument: Instrument): Promise<void> {
  const next = !instrument.retired
  await ElMessageBox.confirm(
    next ? `确认由仪器室停用「${instrument.code}」？停用后其读数只留现场记录。` : `确认恢复「${instrument.code}」？`,
    '仪器室操作',
    { type: 'warning' }
  )
  await instrumentStore.getState().setRetired(instrument.id, next)
  ElMessage.success(next ? '仪器已停用' : '仪器已恢复')
}

function retryGroup(group: ReconcileGroup): void {
  const fresh = reconcileByInstrument(stationState.stations, instrumentState.instruments).find((item) => item.key === group.key)
  if (!fresh) return
  retryKeys.value = [...new Set([...retryKeys.value.filter((key) => key !== group.key), group.key])]
  retryNote.value = `已按台重试 ${group.instrumentNo || '未填仪器号'}：${fresh.status}。读数归属、草图和成果均未移动。`
  ElMessage[fresh.ok ? 'success' : 'warning'](fresh.ok ? '该台仪器对账通过' : '该台仪器仍对账失败')
}

function segmentCode(segmentId: string): string {
  return segmentState.segments.find((segment) => segment.id === segmentId)?.code ?? '未归属洞段'
}

function stationInstrumentStatus(row: Station) {
  return getInstrumentStatus(findInstrument(instrumentState.instruments, row.instrumentNo), row.date)
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">仪器标定档案</h2>
        <p class="page-sub">
          仪器室独立维护标定日期、有效期、结论与停用状态；测量组的现场读数不删除，是否进入正式成果按档案重新判定。
        </p>
      </div>
      <el-button type="primary" @click="openCreate()"><el-icon><Plus /></el-icon>新建标定档案</el-button>
    </div>

    <div class="toolbar">
      <el-tag effect="plain">仪器 {{ instrumentState.instruments.length }} 台</el-tag>
      <el-tag type="success" effect="plain">当前有效 {{ activeInstrumentCount }} 台</el-tag>
      <el-tag :type="failedGroups.length ? 'danger' : 'success'" effect="dark">
        对账{{ failedGroups.length ? `失败 ${failedGroups.length} 台` : '全部通过' }}
      </el-tag>
      <el-tag type="warning" effect="plain">未进成果读数 {{ excludedCount }} 条</el-tag>
    </div>

    <el-alert
      v-if="failedGroups.length"
      class="alert"
      type="error"
      :closable="false"
      title="存在对账失败的仪器"
      description="请由测量组在下方逐台重试；重试只重新读取档案与读数，不改变原成果位置。"
    />

    <div class="two-col">
      <el-card shadow="never" class="panel">
        <template #header>标定档案（仪器室结论）</template>
        <el-table :data="instrumentState.instruments" border stripe>
          <el-table-column prop="code" label="仪器号" width="130" />
          <el-table-column prop="name" label="名称/型号" min-width="150" show-overflow-tooltip />
          <el-table-column prop="calibrationDate" label="标定日期" width="115" />
          <el-table-column prop="validUntil" label="有效期至" width="115" />
          <el-table-column prop="calibrationResult" label="结论" width="90" />
          <el-table-column label="今日状态" width="105">
            <template #default="{ row }: { row: Instrument }">
              <el-tag :type="instrumentStatus(row).usable ? 'success' : 'danger'" size="small" effect="plain">
                {{ instrumentStatus(row).label }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="读数" width="70">
            <template #default="{ row }: { row: Instrument }">{{ readingCount(row.code) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="{ row }: { row: Instrument }">
              <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
              <el-button link :type="row.retired ? 'success' : 'danger'" size="small" @click="toggleRetired(row)">
                {{ row.retired ? '恢复' : '停用' }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <el-card shadow="never" class="panel">
        <template #header>按台对账（测量组重试）</template>
        <el-table :data="instrumentGroups" border stripe>
          <el-table-column label="仪器" min-width="140">
            <template #default="{ row }: { row: ReconcileGroup }">
              {{ row.instrumentNo || '未填仪器号' }}
              <el-tag v-if="row.instrument?.retired" type="danger" size="small" effect="plain">停用</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="读数" width="145">
            <template #default="{ row }: { row: ReconcileGroup }">
              有效 {{ row.effective }} / 在用 {{ row.active }} / 留档 {{ row.archived }}
            </template>
          </el-table-column>
          <el-table-column label="结果" width="100">
            <template #default="{ row }: { row: ReconcileGroup }">
              <el-tag :type="row.ok ? 'success' : 'danger'" size="small" effect="dark">{{ row.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="失败原因 / 重试" min-width="260">
            <template #default="{ row }: { row: ReconcileGroup }">
              <div v-if="row.ok" class="muted">档案与读数一致</div>
              <ul v-else class="reasons">
                <li v-for="(reason, index) in row.reasons" :key="index">{{ reason }}</li>
              </ul>
              <div class="retry-actions">
                <el-button size="small" :type="row.ok ? 'default' : 'primary'" plain @click="retryGroup(row)">
                  按台重试
                </el-button>
                <el-button v-if="!row.instrument" size="small" type="primary" @click="openCreate(row.instrumentNo)">
                  补建档案
                </el-button>
                <span v-if="retriedGroups.some((item) => item.key === row.key)" class="muted">已重试，成果留原处</span>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>

    <el-card v-if="retryNote" shadow="never" class="retry-note">
      {{ retryNote }}
    </el-card>

    <h3 class="section-title">现场读数对账明细</h3>
    <el-table :data="stationState.stations" border stripe>
      <el-table-column label="洞段" width="100">
        <template #default="{ row }: { row: Station }">{{ segmentCode(row.segmentId) }}</template>
      </el-table-column>
      <el-table-column prop="code" label="桩号" width="90" />
      <el-table-column prop="instrumentNo" label="仪器号" width="130" />
      <el-table-column prop="date" label="测量日期" width="120" />
      <el-table-column label="测量组状态" width="100">
        <template #default="{ row }: { row: Station }">{{ READING_STATUS_LABELS[row.readingStatus] }}</template>
      </el-table-column>
      <el-table-column label="仪器室判定" width="110">
        <template #default="{ row }: { row: Station }">
          <el-tag :type="stationInstrumentStatus(row).usable ? 'success' : 'danger'" size="small" effect="plain">
            {{ stationInstrumentStatus(row).label }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="note" label="现场备注" min-width="180" show-overflow-tooltip />
    </el-table>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑仪器标定档案' : '新建仪器标定档案'" width="620px">
      <el-form label-width="110px">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="仪器号" required>
              <el-input v-model="form.code" placeholder="如 SOKKIA-2" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="名称/型号">
              <el-input v-model="form.name" placeholder="如 电子罗盘/激光测距仪" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="标定日期" required>
              <el-date-picker v-model="form.calibrationDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="有效期至" required>
              <el-date-picker v-model="form.validUntil" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="标定结论">
              <el-select v-model="form.calibrationResult" style="width: 100%">
                <el-option v-for="result in CALIBRATION_RESULTS" :key="result" :label="result" :value="result" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="仪器室停用">
              <el-switch v-model="form.retired" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="档案备注">
          <el-input v-model="form.note" type="textarea" :rows="3" placeholder="停用原因、限用范围、证书编号等" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.two-col {
  display: grid;
  grid-template-columns: minmax(420px, 1fr) minmax(480px, 1.1fr);
  gap: 16px;
  margin-bottom: 16px;
}
.panel {
  border-radius: 12px;
}
.alert {
  margin-bottom: 12px;
}
.reasons {
  margin: 0;
  padding-left: 16px;
  color: #b03030;
  font-size: 12px;
  line-height: 1.6;
}
.retry-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}
.retry-note {
  margin-bottom: 16px;
  border-radius: 10px;
  color: #4a5b6b;
}
@media (max-width: 1180px) {
  .two-col {
    grid-template-columns: 1fr;
  }
}
</style>
