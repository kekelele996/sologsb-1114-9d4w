import { createStore } from 'zustand/vanilla'
import type { ReadingStatus, Station } from '@/types'
import { db, syncAll, syncDelete, syncPut } from '@/hooks/usePersistentStore'

export interface StationState {
  stations: Station[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (station: Station) => Promise<void>
  remove: (id: string) => Promise<void>
  setReadingStatus: (id: string, status: ReadingStatus) => Promise<void>
}

/** 同一洞段同一桩号只让一条读数进入成果；其余现场读数保留并改为留档 */
async function archiveSameStation(target: Station): Promise<void> {
  const peers = await db.stations
    .where('segmentId')
    .equals(target.segmentId)
    .toArray()
  await Promise.all(
    peers
      .filter((station) => station.id !== target.id && station.code.trim() === target.code.trim())
      .map((station) => syncPut<Station>(db.stations, { ...station, readingStatus: 'archived' }))
  )
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
    if (station.readingStatus === 'adopted') {
      await archiveSameStation(station)
    }
    await get().hydrate()
  },
  remove: async (id) => {
    await syncDelete(db.stations, id)
    await get().hydrate()
  },
  setReadingStatus: async (id, status) => {
    const target = get().stations.find((station) => station.id === id)
    if (!target) return
    await syncPut<Station>(db.stations, { ...target, readingStatus: status })
    if (status === 'adopted') {
      await archiveSameStation(target)
    }
    await get().hydrate()
  }
}))
