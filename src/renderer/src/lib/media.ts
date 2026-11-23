import type { MediaItem } from '@shared/types'
import { getState } from '../store'

/** Local files go through the media:// protocol; guests in a collab room stream from the host. */
export function mediaUrl(m: Pick<MediaItem, 'id' | 'path'>, kind: 'media' | 'thumb' = 'media', localPath = m.path): string {
  const { collab } = getState()
  if (collab.status === 'connected' && !collab.isHost && collab.mediaBase) {
    return `${collab.mediaBase}/${kind}/${encodeURIComponent(collab.room!)}/${encodeURIComponent(m.id)}?token=${encodeURIComponent(collab.token!)}`
  }
  return `media://file/${encodeURIComponent(localPath)}`
}

export const thumbUrl = (m: MediaItem) => (m.thumbnail ? mediaUrl(m, 'thumb', m.thumbnail) : undefined)
