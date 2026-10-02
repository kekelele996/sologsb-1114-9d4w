import { createStore } from 'zustand/vanilla'
import type { Instrument } from '@/types'
import { db, syncAll, syncDelete, syncPut } from '@/hooks/usePersistentStore'

export interface InstrumentState {
  instruments: Instrument[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (instrument: Instrument) => Promise<void>
  remove: (id: string) => Promise<void>
  setRetired: (id: string, retired: boolean) => Promise<void>
}

export const instrumentStore = createStore<InstrumentState>((set, get) => ({
  instruments: [],
  loaded: false,
  hydrate: async () => {
    const instruments = await syncAll<Instrument>(db.instruments)
    instruments.sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN', { numeric: true }))
    set({ instruments, loaded: true })
  },
  save: async (instrument) => {
    await syncPut<Instrument>(db.instruments, instrument)
    await get().hydrate()
  },
  remove: async (id) => {
    await syncDelete(db.instruments, id)
    await get().hydrate()
  },
  setRetired: async (id, retired) => {
    const target = get().instruments.find((instrument) => instrument.id === id)
    if (!target) return
    await syncPut<Instrument>(db.instruments, { ...target, retired })
    await get().hydrate()
  }
}))
