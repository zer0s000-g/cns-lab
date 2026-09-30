import { useCallback } from 'react'
import { Canvas2D, type DrawFn } from '@/components/sim/Canvas2D'
import { SimLabel } from '@/components/sim/Controls'
import { Term } from '@/components/Term'
import { angleDiff, toRad } from '@/core/geometry'
import { CONTROL_LEVEL_DB, SLS_REPLY_MARGIN_DB, slsReplyHalfAngleDeg, ssrPatternDb, TRANSPONDER_MTL_DBM, uplinkP1Dbm, uplinkP2Dbm } from '@/core/ssr'
import { useSampled } from '@/hooks/useSampled'
import { withAlpha } from '@/lib/color'
import { useSsr, useSsrState } from './state'

const FLOOR_DB = -40

export type HearStatus = 'reply' | 'maybe' | 'silenced' | 'side-lobe-reply' | 'quiet' | 'too-far' | 'off' | 'hidden'

/** What an aircraft does with the interrogation the antenna is sending right now. */
export function hearStatus(engine: ReturnType<typeof useSsr>['engine'], id: string): HearStatus {
  const g = engine.geometry(id)
  if (!g) return 'hidden'
  if (!engine.transponder(id).on) return 'off'
  if (!g.visible) return 'hidden'
  const off = angleDiff(engine.antennaAz, g.az)
  const p1 = uplinkP1Dbm(g.slant, off)
  const inBeam = Math.abs(off) <= slsReplyHalfAngleDeg() * 1.6
  if (p1 < TRANSPONDER_MTL_DBM) return inBeam ? 'too-far' : 'quiet'
  if (engine.env.noP2) return inBeam ? 'reply' : 'side-lobe-reply'
  const d = p1 - uplinkP2Dbm(g.slant, off)
  if (d >= SLS_REPLY_MARGIN_DB) return 'reply'
  if (d <= 0) return 'silenced'
  return 'maybe'
}

export const HEAR_TEXT: Record<HearStatus, string> = {
  reply: 'in the main beam: replies',
  maybe: 'edge of the beam: may reply',
  silenced: 'hears a side lobe, P2 is stronger: stays silent',
  'side-lobe-reply': 'hears a side lobe and, with no P2, replies',
  quiet: 'outside the beam: too faint to hear',
  'too-far': 'in the beam but too far away to trigger',
  off: 'transponder off',
  hidden: 'hidden by terrain or the horizon',
}

/**
 * Polar plot of the antenna pattern, rotating with the antenna: the P1 beam
 * (with its side lobes) against the P2 level from the control antenna.
 */
export function PatternView() {
  const { engine } = useSsr()
  const noP2 = useSsrState((s) => s.env.noP2)
  const mode = useSsrState((s) => s.params.mode)

  const draw: DrawFn = useCallback(
    (ctx, { width, height, tokens: t }) => {
      const e = engine
      ctx.fillStyle = t['sim-bg']
      ctx.fillRect(0, 0, width, height)
      const cx = width / 2
      const cy = height / 2
      const R = Math.max(0, Math.min(width, height) / 2 - 16)
      const rOf = (db: number) => (Math.max(FLOOR_DB, Math.min(0, db)) - FLOOR_DB) / -FLOOR_DB * R
      // dB rings.
      ctx.strokeStyle = t['sim-grid']
      ctx.lineWidth = 1
      ctx.fillStyle = t['sim-muted']
      ctx.font = `500 9px ${t.fontMono}`
      ctx.textAlign = 'right'
      ctx.textBaseline = 'bottom'
      for (const db of [0, -10, -20, -30]) {
        ctx.beginPath()
        ctx.arc(cx, cy, rOf(db), 0, Math.PI * 2)
        ctx.stroke()
        // Labels along the lower-right diagonal, clear of the north mark.
        const k = Math.SQRT1_2 * rOf(db)
        ctx.fillText(db === 0 ? '0 dB' : `${db}`, cx + k - 2, cy + k - 2)
      }
      // P1 pattern (directional antenna), pointing where the antenna points.
      ctx.beginPath()
      for (let d = -180; d <= 180; d += 0.25) {
        const r = rOf(ssrPatternDb(d))
        const a = toRad(e.antennaAz + d - 90)
        const x = cx + Math.cos(a) * r
        const y = cy + Math.sin(a) * r
        if (d === -180) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.fillStyle = withAlpha(t['sim-signal'], 0.22)
      ctx.fill()
      ctx.strokeStyle = t['sim-signal']
      ctx.lineWidth = 1.4
      ctx.stroke()
      // P2 level (control antenna): the same in every direction.
      if (!noP2 && mode === 'ac') {
        ctx.save()
        ctx.strokeStyle = t['sim-warning']
        ctx.setLineDash([5, 4])
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.arc(cx, cy, rOf(CONTROL_LEVEL_DB), 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }
      // Aircraft: at their bearing, on the P1 curve (their P1 level relative to the peak).
      for (const a of e.aircraft) {
        const g = e.geometry(a.id)
        if (!g) continue
        const off = angleDiff(e.antennaAz, g.az)
        const r = Math.max(rOf(ssrPatternDb(off)), 8)
        const ang = toRad(g.az - 90)
        const x = cx + Math.cos(ang) * r
        const y = cy + Math.sin(ang) * r
        const st = hearStatus(e, a.id)
        const hot = st === 'reply' || st === 'side-lobe-reply' || st === 'maybe'
        ctx.fillStyle = hot ? t['sim-ink'] : t['sim-bg']
        ctx.strokeStyle = st === 'side-lobe-reply' ? t['sim-warning'] : t['sim-ink']
        ctx.lineWidth = 1.5
        ctx.beginPath()
        if (hot) ctx.arc(x, y, 4, 0, Math.PI * 2)
        else ctx.rect(x - 3, y - 3, 6, 6)
        ctx.fill()
        ctx.stroke()
        ctx.font = `600 10px ${t.fontSans}`
        ctx.textAlign = x > cx ? 'left' : 'right'
        ctx.textBaseline = 'middle'
        ctx.lineWidth = 3
        ctx.strokeStyle = withAlpha(t['sim-bg'], 0.9)
        const tx = x + (x > cx ? 7 : -7)
        ctx.strokeText(a.callsign, tx, y)
        ctx.fillStyle = t['sim-ink']
        ctx.fillText(a.callsign, tx, y)
      }
      ctx.fillStyle = t['sim-signal']
      ctx.beginPath()
      ctx.arc(cx, cy, 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = t['sim-muted']
      ctx.font = `600 10px ${t.fontSans}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText('N', cx, 2)
    },
    [engine, noP2, mode],
  )

  const rows = useSampled(
    () => engine.aircraft.map((a) => ({ id: a.id, st: hearStatus(engine, a.id) })),
    200,
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  )
  const describe = `Antenna pattern, pointing at ${Math.round(engine.antennaAz)} degrees. ${rows.map((r) => `${r.id}: ${HEAR_TEXT[r.st]}`).join('. ')}.`

  return (
    <div className="hud-panel flex min-w-0 flex-col gap-3 rounded-md p-4">
      <div>
        <h3 className="text-sm font-semibold">Main beam, side lobes and P2</h3>
        <p className="text-xs text-muted-foreground">
          Blue: how strongly the antenna sends P1 in each direction. Dashed: the <Term id="side-lobe-suppression">P2</Term>{' '}
          level from the control antenna.
        </p>
      </div>
      <div className="relative mx-auto w-full max-w-[320px]">
        <Canvas2D draw={draw} label={describe} className="aspect-square w-full rounded-md border" />
        <div className="pointer-events-none absolute top-2 left-2">
          <SimLabel icon="none">Strength in dB, not distance</SimLabel>
        </div>
      </div>
      {mode === 's' && <p className="text-xs text-muted-foreground">Mode S questions carry their own suppression pulse (P5). The P2 test below is for Mode A/C.</p>}
      <ul className="flex flex-col gap-1 text-xs" aria-live="off">
        {rows.map((r) => (
          <li key={r.id} className="flex items-baseline gap-2">
            <span className="w-14 shrink-0 font-mono font-semibold">{r.id}</span>
            <span className={r.st === 'side-lobe-reply' ? 'font-medium text-warning' : r.st === 'reply' ? 'font-medium text-foreground' : 'text-muted-foreground'}>
              {HEAR_TEXT[r.st]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
