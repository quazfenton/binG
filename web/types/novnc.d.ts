declare module '@novnc/novnc' {
  const RFB: {
    new (
      target: HTMLElement,
      url: string,
      options?: {
        credentials?: { password?: string; username?: string }
        shared?: boolean
        repeaterID?: string
        wsProtocols?: string[]
      }
    ): RFBInstance
  }
  export default RFB
}

interface RFBInstance {
  _rfbConnectionState: string
  disconnect(): void
  sendKey(keysym: number, code: number, down: boolean): void
  sendPointer(x: number, y: number, mask: number): void
  set_quality_level?(level: number): void
  setCompressLevel?(level: number): void
  scaleViewport: boolean
  viewOnly: boolean
  addEventListener(type: string, handler: (e: any) => void): void
  removeEventListener(type: string, handler: (e: any) => void): void
}
