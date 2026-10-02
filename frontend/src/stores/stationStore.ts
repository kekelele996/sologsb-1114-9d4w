import { createStore } from 'zustand/vanilla'
import type { Station } from '@/types'
import { db, syncAll, syncDelete, syncPut } from '@/hooks/usePersistentStore'

export interface StationState {
  stations: Station[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (station: Station) => Promise<void>
  remove: (id: string) => Promise<void>
  /** 测量组切换单条读数是否采用 */
  setAdopted: (id: string, adopted: boolean) => Promise<void>
  /** 按仪器号批量采用 / 取消采用（对账后按台重试） */
  setAdoptedByInstrumentNo: (instrumentNo: string, adopted: boolean) => Promise<void>
}

export const stationStore = createStore<StationState>((set, get) => ({
  stations: [],
  loaded: false,
  hydrate: async () => {
    const stations = await syncAll<Station>(db.stations)
    stations.sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN', { numeric: true }))
    set({ stations, loaded: true })
  },
  save: async (station) => {
    await syncPut<Station>(db.stations, station)
    await get().hydrate()
  },
  remove: async (id) => {
    await syncDelete(db.stations, id)
    await get().hydrate()
  },
  setAdopted: async (id, adopted) => {
    const target = get().stations.find((item) => item.id === id)
    if (!target) return
    await syncPut<Station>(db.stations, { ...target, adopted })
    await get().hydrate()
  },
  setAdoptedByInstrumentNo: async (instrumentNo, adopted) => {
    const no = instrumentNo.trim()
    const targets = get().stations.filter((item) => item.instrumentNo.trim() === no)
    await Promise.all(targets.map((item) => syncPut<Station>(db.stations, { ...item, adopted })))
    await get().hydrate()
  }
}))
