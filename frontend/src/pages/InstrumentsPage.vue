<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { CalibrationConclusion, Instrument, InstrumentStatus } from '@/types'
import { useStore } from '@/hooks/usePersistentStore'
import { instrumentStore, draftInstrument } from '@/stores/instrumentStore'
import { stationStore } from '@/stores/stationStore'
import { isInstrumentUsable, missingInstrumentNos } from '@/utils/reading'
import { uid } from '@/utils/id'

const instrumentState = useStore(instrumentStore)
const stationState = useStore(stationStore)

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)

const form = reactive({
  instrumentNo: '',
  name: '全站仪',
  model: '',
  calibrationDate: new Date().toISOString().slice(0, 10),
  validUntil: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().slice(0, 10),
  conclusion: '合格' as CalibrationConclusion,
  status: '在用' as InstrumentStatus,
  note: ''
})

const today = new Date().toISOString().slice(0, 10)

/** 标定已过期：在用 + 合格但过了有效期 */
function isExpired(instrument: Instrument): boolean {
  return instrument.status === '在用' && instrument.conclusion === '合格' && !!instrument.validUntil && instrument.validUntil < today
}

const usableCount = computed(() => instrumentState.instruments.filter((ins) => isInstrumentUsable(ins, today)).length)
const disabledCount = computed(() => instrumentState.instruments.filter((ins) => ins.status === '停用').length)
const expiredCount = computed(() => instrumentState.instruments.filter((ins) => isExpired(ins)).length)

/** 对账：读数里出现过、但标定档案里没有的仪器号 */
const missing = computed(() => missingInstrumentNos(stationState.stations, instrumentState.instruments))

/** 每台仪器关联的读数 / 有效读数条数 */
function stationCountsOf(instrumentNo: string): { total: number; adopted: number } {
  const list = stationState.stations.filter((s) => s.instrumentNo.trim() === instrumentNo.trim())
  return { total: list.length, adopted: list.filter((s) => s.adopted).length }
}

function resetForm(): void {
  editingId.value = null
  form.instrumentNo = ''
  form.name = '全站仪'
  form.model = ''
  form.calibrationDate = today
  form.validUntil = new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().slice(0, 10)
  form.conclusion = '合格'
  form.status = '在用'
  form.note = ''
}

function openCreate(): void {
  resetForm()
  dialogVisible.value = true
}

function openEdit(instrument: Instrument): void {
  editingId.value = instrument.id
  form.instrumentNo = instrument.instrumentNo
  form.name = instrument.name
  form.model = instrument.model
  form.calibrationDate = instrument.calibrationDate
  form.validUntil = instrument.validUntil
  form.conclusion = instrument.conclusion
  form.status = instrument.status
  form.note = instrument.note
  dialogVisible.value = true
}

async function submit(): Promise<void> {
  if (!form.instrumentNo.trim()) {
    ElMessage.warning('请填写仪器号')
    return
  }
  const no = form.instrumentNo.trim()
  const duplicated = instrumentState.instruments.some((ins) => ins.instrumentNo.trim() === no && ins.id !== editingId.value)
  if (duplicated) {
    ElMessage.warning(`仪器号「${no}」已存在`)
    return
  }
  const existing = instrumentState.instruments.find((ins) => ins.id === editingId.value)
  const instrument: Instrument = {
    id: existing?.id ?? uid('ins'),
    instrumentNo: no,
    name: form.name.trim(),
    model: form.model.trim(),
    calibrationDate: form.calibrationDate,
    validUntil: form.validUntil,
    conclusion: form.conclusion,
    status: form.status,
    note: form.note.trim(),
    createdAt: existing?.createdAt ?? new Date().toISOString()
  }
  await instrumentStore.getState().save(instrument)
  dialogVisible.value = false
  ElMessage.success(existing ? '仪器档案已更新' : '仪器档案已建立')
}

async function toggleStatus(instrument: Instrument): Promise<void> {
  const next: InstrumentStatus = instrument.status === '在用' ? '停用' : '在用'
  await instrumentStore.getState().setStatus(instrument.id, next)
  ElMessage.success(next === '停用' ? `仪器 ${instrument.instrumentNo} 已停用，其读数将不计入成果` : `仪器 ${instrument.instrumentNo} 已恢复在用`)
}

async function removeInstrument(instrument: Instrument): Promise<void> {
  const { total } = stationCountsOf(instrument.instrumentNo)
  await ElMessageBox.confirm(
    `确认删除仪器「${instrument.instrumentNo}」的标定档案？${total > 0 ? `该仪器名下有 ${total} 条读数，删除后将回到待确认。` : ''}`,
    '删除确认',
    { type: 'warning' }
  )
  await instrumentStore.getState().remove(instrument.id)
  ElMessage.success('仪器档案已删除')
}

/** 对账建档并采用：为缺失的仪器号建一份默认档案，同时采用该仪器名下全部读数（按台重试） */
async function archiveAndAdopt(instrumentNo: string): Promise<void> {
  await instrumentStore.getState().save(draftInstrument(instrumentNo))
  await stationStore.getState().setAdoptedByInstrumentNo(instrumentNo, true)
  ElMessage.success(`已为 ${instrumentNo} 建档，该仪器名下读数已采用`)
}

/** 重新对账：水合后汇总待建档情况 */
async function reconcile(): Promise<void> {
  await Promise.all([instrumentStore.getState().hydrate(), stationStore.getState().hydrate()])
  if (missing.value.length === 0) {
    ElMessage.success('对账完成：所有读数的仪器号均有标定档案')
  } else {
    ElMessage.warning(`对账完成：${missing.value.length} 台仪器无档案，涉及 ${missing.value.reduce((s, m) => s + m.count, 0)} 条读数，请按台建档`)
  }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">仪器标定档案</h2>
        <p class="page-sub">
          标定结论听仪器室：仪器停用、标定过期或结论不合格时，用它测出的读数不再进正式成果，现场读数照旧留着，补测后才回到成果；用哪条读数仍由测量组定。
        </p>
      </div>
      <div class="head-actions">
        <el-button @click="reconcile">重新对账</el-button>
        <el-button type="primary" @click="openCreate">新建仪器</el-button>
      </div>
    </div>

    <div class="toolbar">
      <el-tag type="success" effect="plain">在用 {{ usableCount }} 台</el-tag>
      <el-tag type="info" effect="plain">停用 {{ disabledCount }} 台</el-tag>
      <el-tag type="warning" effect="plain">标定过期 {{ expiredCount }} 台</el-tag>
      <el-tag type="danger" effect="plain">待建档仪器 {{ missing.length }} 台</el-tag>
    </div>

    <el-alert
      v-if="missing.length > 0"
      class="reconcile-alert"
      type="warning"
      :closable="false"
      title="对账未通过：以下仪器号在读数中出现，但标定档案里查不到"
      description="由测量组按台重试：为每台仪器建档后，其名下读数才会进入正式成果；建档前成果保持原样、不会删除任何读数。"
    />

    <el-card v-if="missing.length > 0" shadow="never" class="missing-card">
      <template #header>待建档仪器（按台重试）</template>
      <el-table :data="missing" border stripe>
        <el-table-column prop="instrumentNo" label="仪器号" width="160">
          <template #default="{ row }: { row: { instrumentNo: string; count: number } }">
            <span class="mono">{{ row.instrumentNo }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="count" label="涉及读数" width="120" />
        <el-table-column label="说明" min-width="220">
          <template #default="{ row }: { row: { instrumentNo: string; count: number } }">
            <span class="muted">该仪器无标定档案，{{ row.count }} 条读数暂列待确认</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180">
          <template #default="{ row }: { row: { instrumentNo: string; count: number } }">
            <el-button type="primary" size="small" @click="archiveAndAdopt(row.instrumentNo)">建档并采用</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <h3 class="section-title">仪器档案清单</h3>
    <el-table :data="instrumentState.instruments" border stripe>
      <el-table-column prop="instrumentNo" label="仪器号" width="140">
        <template #default="{ row }: { row: Instrument }"><span class="mono">{{ row.instrumentNo }}</span></template>
      </el-table-column>
      <el-table-column prop="name" label="名称" width="120" />
      <el-table-column prop="model" label="型号" width="120">
        <template #default="{ row }: { row: Instrument }">{{ row.model || '—' }}</template>
      </el-table-column>
      <el-table-column prop="calibrationDate" label="标定日期" width="120" />
      <el-table-column prop="validUntil" label="有效期至" width="120" />
      <el-table-column label="标定结论" width="110">
        <template #default="{ row }: { row: Instrument }">
          <el-tag :type="row.conclusion === '合格' ? 'success' : 'danger'" size="small" effect="plain">
            {{ row.conclusion }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="仪器状态" width="110">
        <template #default="{ row }: { row: Instrument }">
          <el-tag
            :type="row.status === '停用' ? 'info' : isExpired(row) ? 'warning' : 'success'"
            size="small"
            effect="dark"
          >
            {{ row.status === '停用' ? '停用' : isExpired(row) ? '已过期' : '在用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="读数(采用/总数)" width="130">
        <template #default="{ row }: { row: Instrument }">
          {{ stationCountsOf(row.instrumentNo).adopted }} / {{ stationCountsOf(row.instrumentNo).total }}
        </template>
      </el-table-column>
      <el-table-column prop="note" label="备注" min-width="180" show-overflow-tooltip />
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }: { row: Instrument }">
          <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          <el-button link :type="row.status === '在用' ? 'warning' : 'success'" size="small" @click="toggleStatus(row)">
            {{ row.status === '在用' ? '停用' : '启用' }}
          </el-button>
          <el-button link type="danger" size="small" @click="removeInstrument(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑仪器档案' : '新建仪器档案'" width="620px">
      <el-form label-width="110px">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="仪器号" required>
              <el-input v-model="form.instrumentNo" placeholder="如 SOKKIA-2" :disabled="!!editingId" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="仪器名称">
              <el-input v-model="form.name" placeholder="如 全站仪" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="型号">
          <el-input v-model="form.model" placeholder="如 SET-2X" />
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="标定日期">
              <el-date-picker v-model="form.calibrationDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="有效期至">
              <el-date-picker v-model="form.validUntil" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="标定结论">
              <el-select v-model="form.conclusion" style="width: 100%">
                <el-option label="合格" value="合格" />
                <el-option label="不合格" value="不合格" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="仪器状态">
              <el-select v-model="form.status" style="width: 100%">
                <el-option label="在用" value="在用" />
                <el-option label="停用" value="停用" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="备注">
          <el-input v-model="form.note" type="textarea" :rows="2" placeholder="仪器保管、维修、标定情况等" />
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
.head-actions {
  display: flex;
  gap: 8px;
}
.reconcile-alert {
  margin-bottom: 12px;
}
.missing-card {
  margin-bottom: 16px;
  border-radius: 12px;
}
</style>
