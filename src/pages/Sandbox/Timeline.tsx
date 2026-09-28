import { useCallback, useMemo } from 'react'
import { Canvas2D, type DrawFn } from '@/components/sim/Canvas2D'
import { withAlpha } from '@/lib/color'
import { simulateJourney, type Availability } from './engine'
import { STAGES } from './journey'
import { useSandbox, useSandboxState } from './state'

const ROWS: { key: keyof Availability; label: string; group: 'Surveillance' | 'Navigation' | 'Communication' }[] = [
  { key: 'psr', label: 'Primary radar', group: 'Surveillance' },
  { key: 'ssr', label: 'Secondary radar', group: 'Surveillance' },
  { key: 'adsb', label: 'ADS-B', group: 'Surveillance' },
  { key: 'mlat', label: 'WAM', group: 'Surveillance' },
  { key: 'adsc', label: 'ADS-C', group: 'Surveillance' },
  { key: 'gnss', label: 'GNSS', group: 'Navigation' },
  { key: 'vordme', label: 'VOR/DME', group: 'Navigation' },
  { key: 'ils', label: 'ILS', group: 'Navigation' },
  { key: 'vhf', label: 'VHF voice', group: 'Communication' },
  { key: 'cpdlc', label: 'CPDLC', group: 'Communication' },
  { key: 'satcom', label: 'SATCOM', group: 'Communication' },
  { key: 'hf', label: 'HF voice', group: 'Communication' },
]

const SAMPLES = simulateJourney(20)
const TOTAL_S = SAMPLES[SAMPLES.length - 1].t

/** Which systems CNS700 can use along its whole journey, with the current failures. */
export function Timeline() {
  const { engine } = useSandbox()
  const systems = useSandboxState((s) => s.systems)
  const scenario = useSandboxState((s) => s.scenario)
  const vhfStandby = useSandboxState((s) => s.vhfStandby)
  const journeyEquip = { transponder: 'modeS' as const, adsb: true, fans: true }

  const avail = useMemo(
    () => SAMPLES.map((s) => engine.availability(s.pos, s.altitudeFt, journeyEquip, 10)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, systems, scenario, vhfStandby],
  )

  const draw: DrawFn = useCallback(
    (ctx, { width, height, tokens: t }) => {
      const labelW = width < 480 ? 84 : 120
      const top = 34
      const rowH = (height - top - 18) / ROWS.length
      const w = width - labelW - 8
      const xOf = (s: number) => labelW + (s / TOTAL_S) * w
      ctx.fillStyle = t['card']
      ctx.fillRect(0, 0, width, height)

      // Stage bands.
      let start = 0
      for (let i = 1; i <= SAMPLES.length; i++) {
        const cur = SAMPLES[i - 1].stage
        const next = SAMPLES[i]?.stage
        if (next !== cur) {
          const x0 = xOf(SAMPLES[start].t)
          const x1 = xOf(SAMPLES[i - 1].t)
          const k = STAGES.indexOf(cur as (typeof STAGES)[number])
          ctx.fillStyle = withAlpha(t['sim-signal'], k % 2 === 0 ? 0.08 : 0.16)
          ctx.fillRect(x0, 4, Math.max(1, x1 - x0), 22)
          ctx.fillStyle = t['foreground']
          ctx.font = `600 10px ${t.fontSans}`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          if (x1 - x0 > 44) ctx.fillText(cur, (x0 + x1) / 2, 15)
          start = i
        }
      }

      // Rows.
      ROWS.forEach((r, ri) => {
        const y = top + ri * rowH
        if (ri === 0 || ROWS[ri - 1].group !== r.group) {
          ctx.strokeStyle = t['border']
          ctx.beginPath()
          ctx.moveTo(0, y - 1)
          ctx.lineTo(width, y - 1)
          ctx.stroke()
        }
        ctx.fillStyle = t['muted-foreground']
        ctx.font = `500 10px ${t.fontSans}`
        ctx.textAlign = 'right'
        ctx.textBaseline = 'middle'
        ctx.fillText(r.label, labelW - 8, y + rowH / 2)
        ctx.fillStyle = withAlpha(t['foreground'], 0.05)
        ctx.fillRect(labelW, y + 2, w, rowH - 4)
        ctx.fillStyle = r.group === 'Surveillance' ? t['chart-1'] : r.group === 'Navigation' ? t['chart-3'] : t['chart-4']
        for (let i = 0; i < SAMPLES.length - 1; i++) {
          if (!avail[i][r.key]) continue
          const x0 = xOf(SAMPLES[i].t)
          const x1 = xOf(SAMPLES[i + 1].t)
          ctx.fillRect(x0, y + 3, x1 - x0 + 0.6, rowH - 6)
        }
      })

      // Time axis.
      ctx.fillStyle = t['muted-foreground']
      ctx.font = `500 10px ${t.fontMono}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      for (let m = 0; m * 60 <= TOTAL_S; m += 30) ctx.fillText(`${m} min`, Math.min(width - 20, Math.max(labelW + 14, xOf(m * 60))), height - 2)

      // Now marker.
      const a = engine.journeyAircraft
      if (a?.journey) {
        const jt = Math.min(TOTAL_S, engine.timeS - a.journey.startS)
        const x = xOf(jt)
        ctx.strokeStyle = t['destructive']
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(x, 2)
        ctx.lineTo(x, height - 14)
        ctx.stroke()
        ctx.fillStyle = t['destructive']
        ctx.beginPath()
        ctx.moveTo(x - 5, 2)
        ctx.lineTo(x + 5, 2)
        ctx.lineTo(x, 8)
        ctx.closePath()
        ctx.fill()
      }
    },
    [engine, avail],
  )

  const label = useMemo(() => {
    const parts = ROWS.map((r) => {
      const n = avail.filter((x) => x[r.key]).length
      return `${r.label} ${Math.round((n / avail.length) * 100)}% of the journey`
    })
    return `Journey timeline for CNS700, about ${Math.round(TOTAL_S / 60)} minutes. ${parts.join(', ')}.`
  }, [avail])

  return <Canvas2D draw={draw} label={label} className="h-64 w-full rounded-lg border bg-card" />
}
