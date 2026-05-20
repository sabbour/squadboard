/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SQUADBOARD_AUTH_TOKEN?: string
}

declare module '*.svg' {
  const src: string
  export default src
}
