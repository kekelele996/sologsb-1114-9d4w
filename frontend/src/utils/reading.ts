import type { Instrument, Station } from '@/types'

/** 读数状态：有效（进成果）/ 排除（仪器或测量组原因）/ 待确认（无仪器档案） */
export type ReadingState = 'valid' | 'excluded' | 'pending'

export interface ReadingVerdict {
  state: ReadingState
  /** 排除 / 待确认原因，含仪器号，可直接展示 */
  reason: string
  /** 判定所依据的仪器档案（无档案时为 null） */
  instrument: Instrument | null
}

/** 当天日期串（YYYY-MM-DD），用于标定有效期比对 */
export function todayString(): string {
  return new Date().toISOString().slice(0, 10)
}

/** 仪器当前是否可用：在用 + 标定合格 + 在有效期内 */
export function isInstrumentUsable(
  instrument: Instrument | null | undefined,
  today: string = todayString()
): boolean {
  if (!instrument) return false
  if (instrument.status !== '在用') return false
  if (instrument.conclusion !== '合格') return false
  if (instrument.validUntil && instrument.validUntil < today) return false
  return true
}

/** 仪器号归一化（去空格），便于对账匹配 */
export function normalizeInstrumentNo(no: string): string {
  return no.trim()
}

/**
 * 判定一条读数能否进入正式成果。
 * 标定结论听仪器室（仪器状态 / 有效期 / 结论），用哪条读数由测量组定（adopted）。
 */
export function verdictFor(
  station: Station,
  instrument: Instrument | null | undefined,
  today: string = todayString()
): ReadingVerdict {
  const no = normalizeInstrumentNo(station.instrumentNo)
  if (!instrument) {
    return {
      state: 'pending',
      reason: `仪器号「${no || '未填'}」无标定档案，待对账确认`,
      instrument: null
    }
  }
  if (instrument.status === '停用') {
    return { state: 'excluded', reason: `仪器 ${no} 已被仪器室停用，读数不计入成果`, instrument }
  }
  if (instrument.conclusion !== '合格') {
    return {
      state: 'excluded',
      reason: `仪器 ${no} 标定结论为「${instrument.conclusion}」，读数不计入成果`,
      instrument
    }
  }
  if (instrument.validUntil && instrument.validUntil < today) {
    return {
      state: 'excluded',
      reason: `仪器 ${no} 标定已过期（有效期至 ${instrument.validUntil}），读数不计入成果`,
      instrument
    }
  }
  if (!station.adopted) {
    return {
      state: 'excluded',
      reason: `测量组未采用 ${no} 的这条读数（待补测或手动排除）`,
      instrument
    }
  }
  return { state: 'valid', reason: '', instrument }
}

/** 由仪器号建立索引，便于批量判定 */
export function instrumentIndex(instruments: Instrument[]): Map<string, Instrument> {
  return new Map(instruments.map((ins) => [normalizeInstrumentNo(ins.instrumentNo), ins]))
}

/** 从读数列表中筛出可进入正式成果的有效读数（闭合差 / 草图折线 / 拼合锚点只算这些） */
export function validStations(
  stations: Station[],
  instruments: Instrument[],
  today: string = todayString()
): Station[] {
  const index = instrumentIndex(instruments)
  return stations.filter(
    (station) => verdictFor(station, index.get(normalizeInstrumentNo(station.instrumentNo)), today).state === 'valid'
  )
}

/** 读数中出现过、但标定档案里没有的仪器号（对账用），按仪器号聚合测点数 */
export function missingInstrumentNos(
  stations: Station[],
  instruments: Instrument[]
): { instrumentNo: string; count: number }[] {
  const known = new Set(instruments.map((ins) => normalizeInstrumentNo(ins.instrumentNo)))
  const counts = new Map<string, number>()
  for (const station of stations) {
    const no = normalizeInstrumentNo(station.instrumentNo)
    if (!no || known.has(no)) continue
    counts.set(no, (counts.get(no) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([instrumentNo, count]) => ({ instrumentNo, count }))
    .sort((a, b) => b.count - a.count || a.instrumentNo.localeCompare(b.instrumentNo, 'zh-Hans-CN'))
}
