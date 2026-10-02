import type { Instrument, ReadingStatus, Station, ExcludedReading } from '@/types'

export const READING_STATUS_LABELS: Record<ReadingStatus, string> = {
  adopted: '采用',
  archived: '留档',
  pending: '待确认'
}

export type InstrumentIssue =
  | 'missing'
  | 'retired'
  | 'unqualified'
  | 'restricted'
  | 'expired'
  | 'before-calibration'
  | 'invalid-date'

export interface InstrumentStatus {
  usable: boolean
  issue?: InstrumentIssue
  label: string
  reason: string
}

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime())
}

function instrumentLabel(instrument: Instrument): string {
  return `${instrument.code} · ${instrument.name || '未命名仪器'}`
}

/** 仪器室标定结论在指定测量日期是否允许进入正式成果 */
export function getInstrumentStatus(instrument: Instrument | undefined, measuredAt: string): InstrumentStatus {
  if (!instrument) {
    return { usable: false, issue: 'missing', label: '无档案', reason: '仪器室无此仪器标定档案' }
  }
  if (instrument.retired) {
    return { usable: false, issue: 'retired', label: '已停用', reason: `仪器室已停用 ${instrumentLabel(instrument)}` }
  }
  if (instrument.calibrationResult === '不合格') {
    return {
      usable: false,
      issue: 'unqualified',
      label: '不合格',
      reason: `${instrumentLabel(instrument)} 标定结论不合格`
    }
  }
  if (instrument.calibrationResult === '限用') {
    return {
      usable: false,
      issue: 'restricted',
      label: '限用',
      reason: `${instrumentLabel(instrument)} 标定结论为限用，不纳入本正式成果`
    }
  }
  if (!isValidDate(instrument.calibrationDate) || !isValidDate(instrument.validUntil)) {
    return {
      usable: false,
      issue: 'invalid-date',
      label: '日期异常',
      reason: `${instrumentLabel(instrument)} 标定日期或有效期不完整`
    }
  }
  if (!isValidDate(measuredAt)) {
    return {
      usable: false,
      issue: 'invalid-date',
      label: '测量日期异常',
      reason: `${instrumentLabel(instrument)} 对应读数缺少有效测量日期`
    }
  }
  if (measuredAt < instrument.calibrationDate) {
    return {
      usable: false,
      issue: 'before-calibration',
      label: '早于标定',
      reason: `${instrumentLabel(instrument)} 测量日期早于 ${instrument.calibrationDate} 标定日期`
    }
  }
  if (measuredAt > instrument.validUntil) {
    return {
      usable: false,
      issue: 'expired',
      label: '已过期',
      reason: `${instrumentLabel(instrument)} 标定已于 ${instrument.validUntil} 到期`
    }
  }
  return { usable: true, label: '有效', reason: `${instrumentLabel(instrument)} 标定有效（至 ${instrument.validUntil}）` }
}

export function findInstrument(instruments: Instrument[], instrumentNo: string): Instrument | undefined {
  const code = instrumentNo.trim().toLowerCase()
  return instruments.find((instrument) => instrument.code.trim().toLowerCase() === code)
}

export interface ReadingResolution {
  effective: boolean
  label: string
  reason: string
  instrumentStatus: InstrumentStatus
}

/** 正式成果同时要求：测量组采用该读数，且仪器室档案在测量当日有效 */
export function resolveReading(station: Station, instruments: Instrument[]): ReadingResolution {
  const instrument = findInstrument(instruments, station.instrumentNo)
  const instrumentStatus = getInstrumentStatus(instrument, station.date)
  const instrumentText = station.instrumentNo.trim() || '未填仪器号'

  if (station.readingStatus === 'archived') {
    return {
      effective: false,
      label: '留档排除',
      reason: `测量组已留档；现场读数保留，仪器：${instrumentText}`,
      instrumentStatus
    }
  }

  if (station.readingStatus === 'pending') {
    return {
      effective: false,
      label: '待确认',
      reason: instrumentStatus.usable
        ? `测量组尚未确认采用；仪器：${instrumentText}`
        : `测量组尚未确认，且${instrumentStatus.reason}`,
      instrumentStatus
    }
  }

  if (!instrumentStatus.usable) {
    return {
      effective: false,
      label: instrumentStatus.label,
      reason: `${instrumentStatus.reason}；读数桩号 ${station.code}`,
      instrumentStatus
    }
  }

  return {
    effective: true,
    label: '有效',
    reason: `测量组已采用，${instrumentStatus.reason}`,
    instrumentStatus
  }
}

export function effectiveStations(stations: Station[], instruments: Instrument[]): Station[] {
  return stations.filter((station) => resolveReading(station, instruments).effective)
}

export function getExcludedReadings(stations: Station[], instruments: Instrument[]): ExcludedReading[] {
  return stations
    .map((station) => ({ station, resolution: resolveReading(station, instruments) }))
    .filter((item) => !item.resolution.effective)
    .map((item) => ({ station: item.station, reason: item.resolution.reason }))
}

export function closureDetailWithExclusions(baseDetail: string, excluded: ExcludedReading[]): string {
  if (excluded.length === 0) return baseDetail
  const lines = excluded.map((item) => `${item.station.code}（${item.station.instrumentNo || '未填仪器号'}）：${item.reason}`)
  return `${baseDetail}；未参与正式成果 ${excluded.length} 条：${lines.join('；')}`
}
