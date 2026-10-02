import { createStore } from 'zustand/vanilla'
import type { Instrument, InstrumentStatus } from '@/types'
import { db, syncAll, syncDelete, syncPut } from '@/hooks/usePersistentStore'
import { uid } from '@/utils/id'

export interface InstrumentState {
  instruments: Instrument[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (instrument: Instrument) => Promise<void>
  remove: (id: string) => Promise<void>
  setStatus: (id: string, status: InstrumentStatus) => Promise<void>
}

export const instrumentStore = createStore<InstrumentState>((set, get) => ({
  instruments: [],
  loaded: false,
  hydrate: async () => {
    const instruments = await syncAll<Instrument>(db.instruments)
    instruments.sort((a, b) => a.instrumentNo.localeCompare(b.instrumentNo, 'zh-Hans-CN'))
    set({ instruments, loaded: true })
  },
  save: async (instrument) => {
    await syncPut<Instrument>(db.instruments, instrument)
    await get().hydrate()
  },
  remove: async (id) => {
    await syncDelete<Instrument>(db.instruments, id)
    await get().hydrate()
  },
  setStatus: async (id, status) => {
    const target = get().instruments.find((item) => item.id === id)
    if (!target) return
    await syncPut<Instrument>(db.instruments, { ...target, status })
    await get().hydrate()
  }
}))

/** 对账建档用：生成一台默认在用、标定合格、有效期一年的仪器档案 */
export function draftInstrument(instrumentNo: string): Instrument {
  const today = new Date().toISOString().slice(0, 10)
  const nextYear = new Date()
  nextYear.setFullYear(nextYear.getFullYear() + 1)
  return {
    id: uid('ins'),
    instrumentNo: instrumentNo.trim(),
    name: '全站仪',
    model: '',
    calibrationDate: today,
    validUntil: nextYear.toISOString().slice(0, 10),
    conclusion: '合格',
    status: '在用',
    note: '对账建档：请补全仪器型号与标定信息',
    createdAt: new Date().toISOString()
  }
}
