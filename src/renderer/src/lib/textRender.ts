import type { Clip, TextStyle } from '@shared/types'
import { BASE_TEXT_STYLE } from '@shared/presets'

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word
      if (line && ctx.measureText(test).width > maxWidth) {
        lines.push(line)
        line = word
      } else line = test
    }
    lines.push(line)
  }
  return lines
}

/** Draw a text clip at local time t (seconds since clip start). Shared by preview and export rasterisation. */
export function drawTextClip(ctx: CanvasRenderingContext2D, clip: Clip, W: number, H: number, t: number | null): void {
  const st: TextStyle = { ...BASE_TEXT_STYLE, ...clip.textStyle }
  let text = clip.text ?? ''
  if (st.uppercase) text = text.toUpperCase()
  const scaleK = H / 1080
  let alpha = clip.transform?.opacity ?? 1
  let dy = 0
  let pop = 1
  if (t !== null) {
    const inT = Math.min(0.4, clip.duration / 3)
    const outLeft = clip.duration - t
    const pIn = Math.min(1, t / inT)
    const ease = 1 - (1 - pIn) ** 3
    switch (clip.animIn) {
      case 'fade':
        alpha *= ease
        break
      case 'slide-up':
        alpha *= ease
        dy = (1 - ease) * 60 * scaleK
        break
      case 'pop':
        pop = pIn < 1 ? 0.6 + 0.5 * ease - 0.1 * Math.sin(ease * Math.PI) : 1
        alpha *= Math.min(1, pIn * 2)
        break
      case 'typewriter':
        text = text.slice(0, Math.ceil(text.length * Math.min(1, t / Math.max(0.3, clip.duration * 0.6))))
        break
    }
    if (clip.animOut === 'fade' && outLeft < inT) alpha *= Math.max(0, outLeft / inT)
    if (clip.fadeIn > 0 && t < clip.fadeIn) alpha *= t / clip.fadeIn
    if (clip.fadeOut > 0 && outLeft < clip.fadeOut) alpha *= Math.max(0, outLeft / clip.fadeOut)
  }
  if (alpha <= 0 || !text) return
  const size = st.fontSize * scaleK * (clip.transform?.scale ?? 1) * pop
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.font = `${st.fontWeight} ${size}px ${st.fontFamily}`
  ctx.textBaseline = 'middle'
  ctx.textAlign = st.align
  const lines = wrap(ctx, text, st.maxWidth * W)
  const lh = size * 1.18
  const x = st.x * W + (clip.transform?.x ?? 0) * scaleK
  const y0 = st.y * H + (clip.transform?.y ?? 0) * scaleK + dy - ((lines.length - 1) * lh) / 2
  if (st.background) {
    const widths = lines.map((l) => ctx.measureText(l).width)
    const w = Math.max(...widths) + size * 0.8
    const h = lines.length * lh + size * 0.4
    const left = st.align === 'center' ? x - w / 2 : st.align === 'right' ? x - w + size * 0.4 : x - size * 0.4
    ctx.fillStyle = st.background
    ctx.beginPath()
    ctx.roundRect(left, y0 - lh / 2 - size * 0.2, w, h, size * 0.18)
    ctx.fill()
  }
  if (st.shadow) {
    ctx.shadowColor = clip.textStyle?.strokeColor && st.strokeWidth < 5 ? st.strokeColor : 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = size * 0.25
    ctx.shadowOffsetY = size * 0.04
  }
  lines.forEach((line, i) => {
    const y = y0 + i * lh
    if (st.strokeWidth > 0) {
      ctx.lineJoin = 'round'
      ctx.lineWidth = st.strokeWidth * scaleK * 2
      ctx.strokeStyle = st.strokeColor
      ctx.strokeText(line, x, y)
    }
    ctx.fillStyle = st.color
    ctx.fillText(line, x, y)
  })
  ctx.restore()
}

export function rasterizeText(clip: Clip, W: number, H: number): string {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  drawTextClip(c.getContext('2d')!, clip, W, H, null)
  return c.toDataURL('image/png')
}
