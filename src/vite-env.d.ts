/// <reference types="vite/client" />

import type { EzOfficeApi } from './shared/types/api'

declare global {
  interface Window {
    api: EzOfficeApi
  }
}
