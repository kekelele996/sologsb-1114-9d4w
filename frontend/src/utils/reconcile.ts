import type { Instrument, Station } from '@/types'
import { findInstrument, getInstrumentStatus } from '@/utils/instrument'

export interface ReconcileGroup {
  key: string
  instrumentNo: string
  instrument?: Instrument
  total: number
  archived: number
  active: number
  effective: number
  pending: number
  ok: boolean
  status: string
  reasons: string[]
}

/**
 * 仪器室档案与测量组现场读数对账。
 * 只按仪器分组重新判断，不改读数、洞段成果或草图位置。
 */
export function reconcileByInstrument(stations: Station[], instruments: Instrument[]): ReconcileGroup[] {
  const keys = new Set<string>()
  for (const station of stations) keys.add(station.instrumentNo.trim() || '__missing__')

  return Array.from(keys)
    .map((key) => {
      const instrumentNo = key === '__missing__' ? '' : key
      const instrument = key === '__missing__' ? undefined : findInstrument(instruments, instrumentNo)
      const readings = stations.filter(
        (station) => (station.instrumentNo.trim() || '__missing__') === key
      )
      const active = readings.filter((station) => station.readingStatus !== 'archived')
      const pending = active.filter((station) => station.readingStatus === 'pending').length
      const reasons: string[] = []

      if (!instrument && active.length > 0) {
        reasons.push('仪器室没有该仪器档案')
      }
      if (instrument) {
        for (const station of active) {
          const status = getInstrumentStatus(instrument, station.date)
          if (!status.usable) reasons.push(`${station.code}：${status.reason}`)
        }
      }
      if (pending > 0) reasons.push(`${pending} 条读数仍为待确认，测量组尚未决定是否采用`)

      const effective = active.filter((station) => {
        if (station.readingStatus !== 'adopted') return false
        return getInstrumentStatus(findInstrument(instruments, station.instrumentNo), station.date).usable
      }).length

      const ok = reasons.length === 0
      return {
        key,
        instrumentNo,
        instrument,
        total: readings.length,
        archived: readings.length - active.length,
        active: active.length,
        effective,
        pending,
        ok,
        status: ok ? '对账通过' : '对账失败',
        reasons
      }
    })
    .sort((a, b) => Number(a.ok) - Number(b.ok) || a.instrumentNo.localeCompare(b.instrumentNo, 'zh-Hans-CN', { numeric: true }))
}
