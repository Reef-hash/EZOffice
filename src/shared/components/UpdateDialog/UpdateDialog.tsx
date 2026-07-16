import { useState, useEffect, useCallback } from 'react'
import { Button } from '../Button/Button'
import { Modal } from '../Modal'

type UpdateState =
  | { phase: 'idle' }
  | { phase: 'available'; version: string }
  | { phase: 'downloading'; version: string; progress: number }
  | { phase: 'downloaded'; version: string }

export function UpdateDialog() {
  const [state, setState] = useState<UpdateState>({ phase: 'idle' })

  useEffect(() => {
    const unsubStatus = window.api.updater.onStatusChange((data) => {
      if (data.status === 'available' && data.version) {
        setState({ phase: 'available', version: data.version })
      } else if (data.status === 'downloaded' && data.version) {
        setState({ phase: 'downloaded', version: data.version as string })
      }
    })

    const unsubProgress = window.api.updater.onDownloadProgress((progress) => {
      setState((prev) => {
        if (prev.phase === 'available' || prev.phase === 'idle') return prev
        return { ...prev, progress }
      })
    })

    return () => {
      unsubStatus()
      unsubProgress()
    }
  }, [])

  const handleDownload = useCallback(async () => {
    if (state.phase !== 'available') return
    setState({ phase: 'downloading', version: state.version, progress: 0 })
    try {
      await window.api.updater.startDownload()
      // Status will transition to 'downloaded' via the event listener
    } catch {
      setState({ phase: 'idle' })
    }
  }, [state])

  const handleInstall = useCallback(async () => {
    await window.api.updater.installNow()
  }, [])

  if (state.phase === 'idle') return null

  return (
    <Modal isOpen={true} onClose={() => {}} title="" size="sm">
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        {state.phase === 'available' && (
          <>
            <div className="flex size-14 items-center justify-center rounded-full bg-primary-100">
              <svg className="size-7 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 10l5 5 5-5M12 15V3" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-neutral-900">Update Available</h3>
              <p className="mt-1 text-sm text-neutral-500">
                Version {state.version} is ready to download.
              </p>
            </div>
            <Button variant="primary" size="md" onClick={handleDownload}>
              Download Update
            </Button>
          </>
        )}

        {state.phase === 'downloading' && (
          <>
            <div className="flex size-14 items-center justify-center rounded-full bg-primary-100">
              <svg className="size-7 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 10l5 5 5-5M12 15V3" />
              </svg>
            </div>
            <div className="w-full">
              <h3 className="text-lg font-semibold text-neutral-900">Downloading...</h3>
              <p className="mt-1 text-sm text-neutral-500">
                Version {state.version}
              </p>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-neutral-200">
                <div
                  className="h-full rounded-full bg-primary-600 transition-all duration-300"
                  style={{ width: `${Math.min(state.progress, 100)}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-neutral-400">{Math.round(state.progress)}%</p>
            </div>
          </>
        )}

        {state.phase === 'downloaded' && (
          <>
            <div className="flex size-14 items-center justify-center rounded-full bg-success-100">
              <svg className="size-7 text-success-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-neutral-900">Ready to Install</h3>
              <p className="mt-1 text-sm text-neutral-500">
                Version {state.version} has been downloaded. Restart to apply the update.
              </p>
            </div>
            <Button variant="primary" size="md" onClick={handleInstall}>
              Install & Restart
            </Button>
          </>
        )}
      </div>
    </Modal>
  )
}
