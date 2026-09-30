import { useState } from "react";
import { wholeDegrees } from "@/lib/format";
import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ClockControls,
  ClockSpeedLabel,
  ControlSlider,
  SimLabel,
} from "@/components/sim/Controls";
import { ChapterHead } from "@/components/module/ModuleLayout";
import { Term } from "@/components/Term";
import { bearingDeg, normalize360 } from "@/core/geometry";
import { realToSignalUs, slowMotionFor } from "@/core/clock";
import { roundTripTimeUs } from "@/core/propagation";
import {
  azimuthResolutionNm,
  hitsPerScan,
  maxDetectionRangeNm,
  maxUnambiguousRangeNm,
  RCS_M2,
} from "@/core/radar";
import { useClock, useSimulationLoop } from "@/hooks/useSimClock";
import { useSampled } from "@/hooks/useSampled";
import { Dial, LeverSwitch, Segmented } from "@/hud/Controls";
import { HudPanel } from "@/hud/HudFrame";
import { BarMeter, NeedleGauge, TelemetryRow } from "@/hud/Telemetry";
import { RadarScope } from "@/instruments";
import { PulseView, REPLAY_REAL_S, buildReplay } from "./PulseView";
import { REASON_TEXT, TruthMap } from "./TruthMap";
import { usePsr, usePsrState } from "./state";

export function formatPower(kw: number) {
  return kw >= 1000
    ? `${(kw / 1000).toFixed(kw >= 10000 ? 0 : 1)} MW`
    : `${kw >= 100 ? Math.round(kw) : kw.toFixed(kw < 10 ? 1 : 0)} kW`;
}

/** Drives the PSR engine. Rendered once per page, inside the Simulator chapter. */
function usePsrLoop() {
  const { engine, clock, store, replayRef } = usePsr();
  useSimulationLoop(clock, (dt, realDt) => {
    const s = store.getState();
    engine.params = s.params;
    engine.env = s.env;
    if (s.pulse.phase === "replay") {
      if (clock.getState().running) {
        // The learner pressed Play: leave the frozen replay and go back to live.
        replayRef.current = null;
        s.setPulse({ phase: "idle" });
      } else if (replayRef.current) {
        const rp = replayRef.current;
        rp.tUs = Math.min(
          rp.totalUs,
          rp.tUs +
            realToSignalUs(realDt, slowMotionFor(rp.totalUs, REPLAY_REAL_S)),
        );
        return;
      }
    }
    if (s.pulse.phase === "armed" && s.pulse.targetId) {
      const a = engine.getAircraft(s.pulse.targetId);
      if (!a) {
        s.setPulse({ phase: "idle" });
      } else if (dt > 0) {
        const az = bearingDeg(engine.site.pos, a.pos);
        if (engine.timeToAzimuth(az) <= dt) {
          engine.advanceToAzimuth(az);
          clock.getState().pause();
          replayRef.current = buildReplay(engine, s.scopeRangeNm, a.id);
          s.setPulse({ ...s.pulse, phase: "replay", azDeg: az });
          return;
        }
      }
    }
    engine.step(dt);
  });
}

/**
 * The Simulator chapter: a console laid over the 3D stage. Left, what the
 * radar screen shows; right, the control deck; below, one pulse in slow motion.
 * The stage behind shows what is really out there.
 */
export function PsrSimulator() {
  usePsrLoop();
  const { engine, clock, replayRef } = usePsr();
  const range = usePsrState((s) => s.scopeRangeNm);
  const params = usePsrState((s) => s.params);
  const [view, setView] = useState<"scope" | "map">("scope");

  return (
    <div className="flex flex-col gap-4">
      <div className="hud-panel rounded-md px-5 py-4 md:w-fit md:max-w-[520px]">
        <ChapterHead
          n={2}
          title="Simulator"
          lead="The table behind is what is really out there. The screen shows only what the radar can work out."
        />
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,420px)_1fr_minmax(0,340px)]">
        <div className="flex min-w-0 flex-col gap-4">
          <HudPanel
            index="PPI"
            title={view === "scope" ? "Radar screen" : "Tactical map"}
            actions={
              <Segmented
                value={view}
                onChange={setView}
                options={[
                  { value: "scope", label: "Screen" },
                  { value: "map", label: "Map" },
                ]}
                className="w-[140px]"
              />
            }
            bodyClassName="p-3"
          >
            <div className="relative">
              {view === "scope" ? (
                <RadarScope
                  maxRangeNm={range}
                  persistenceS={params.rotationPeriodS * 0.9}
                  read={() => ({
                    nowS: engine.timeS,
                    sweepAzDeg: engine.antennaAz,
                    beamWidthDeg: engine.params.beamWidthDeg,
                    paints: engine.takePaints(),
                  })}
                  describe={() => describeScope(engine)}
                />
              ) : (
                <TruthMap />
              )}
              <div className="pointer-events-none absolute top-2 left-2 flex flex-wrap gap-1.5">
                <ClockSpeedLabel clock={clock} />
                {view === "scope" && (
                  <SimLabel icon="none">
                    Turn {params.rotationPeriodS.toFixed(1)} s
                  </SimLabel>
                )}
              </div>
            </div>
            <p className="mt-2.5 text-[11.5px] leading-5 text-muted-foreground">
              {view === "scope" ? (
                <>
                  Bright arcs are echoes, each as wide as the{" "}
                  <Term id="beam-width">beam</Term>. Grey speckle is{" "}
                  <Term id="clutter">clutter</Term>; pale patches are rain. No
                  names, no heights.
                </>
              ) : (
                "God’s-eye map with callsigns. Drag an aircraft, or select it and use the arrow keys."
              )}
            </p>
          </HudPanel>
          <Readouts />
        </div>
        <div aria-hidden className="hidden md:block" />
        <ControlDeck />
      </div>
      <PulseView replayRef={replayRef} />
    </div>
  );
}

function describeScope(engine: ReturnType<typeof usePsr>["engine"]) {
  const seen = engine.aircraft.filter(
    (a) => engine.lastLook.get(a.id)?.detected,
  ).length;
  return `Radar screen: sweep at ${Math.round(engine.antennaAz)} degrees. On the last turn the radar painted ${seen} of ${engine.aircraft.length} aircraft. Primary radar shows only echoes, without names or heights.`;
}

function Readouts() {
  const { engine } = usePsr();
  const params = usePsrState((s) => s.params);
  const selectedId = usePsrState((s) => s.selectedId);
  const sel = useSampled(() => {
    const a = engine.getAircraft(selectedId);
    const look = a ? engine.lastLook.get(a.id) : undefined;
    return a && look
      ? {
          id: a.callsign,
          range: look.trueRangeNm,
          shown: look.apparentRangeNm,
          trace: look.trace,
          echoUs: roundTripTimeUs(look.trueRangeNm),
          reason: look.reason,
          detected: look.detected,
          pd: look.pd,
        }
      : a
        ? {
            id: a.callsign,
            range: NaN,
            shown: NaN,
            trace: 1,
            echoUs: NaN,
            reason: "ok" as const,
            detected: false,
            pd: 0,
          }
        : null;
  }, 250);
  const ru = maxUnambiguousRangeNm(params.prfHz);
  return (
    <HudPanel index="TLM" title="Radar telemetry" bodyClassName="px-4 py-2">
      <div className="flex flex-col divide-y divide-hud-line">
        <TelemetryRow
          label="Update interval"
          value={params.rotationPeriodS.toFixed(1)}
          unit="s"
        />
        <TelemetryRow
          label="Max unambiguous range"
          value={ru.toFixed(0)}
          unit="NM"
          tone={ru < 60 ? "brass" : "default"}
          bar={Math.min(1, ru / 120)}
        />
        <TelemetryRow
          label="Medium aircraft seen to"
          value={maxDetectionRangeNm(params, RCS_M2.medium).toFixed(0)}
          unit="NM"
        />
        <TelemetryRow
          label="Small aircraft seen to"
          value={maxDetectionRangeNm(params, RCS_M2.light).toFixed(0)}
          unit="NM"
        />
        <TelemetryRow
          label="Pulses on each aircraft"
          value={hitsPerScan(params).toFixed(0)}
          unit="/turn"
        />
        <TelemetryRow
          label="Beam width at 30 NM"
          value={azimuthResolutionNm(30, params.beamWidthDeg).toFixed(2)}
          unit="NM"
        />
        {sel && (
          <>
            <TelemetryRow
              label={`${sel.id} echo time`}
              value={Number.isFinite(sel.echoUs) ? sel.echoUs.toFixed(0) : "—"}
              unit="µs"
              tone="signal"
            />
            <TelemetryRow
              label={`${sel.id} on the screen`}
              value={
                sel.detected
                  ? sel.trace > 1
                    ? `${sel.shown.toFixed(1)} NM`
                    : "Seen"
                  : Number.isFinite(sel.range)
                    ? "Not seen"
                    : "—"
              }
              tone={sel.detected ? (sel.trace > 1 ? "brass" : "ok") : "muted"}
            />
            <div className="flex items-center justify-between gap-3 py-2">
              <span className="hud-label">Chance of a blip each turn</span>
              <span className="flex items-center gap-2.5">
                <BarMeter
                  orientation="horizontal"
                  value={sel.pd}
                  label={`Chance ${sel.id} is painted on each turn`}
                  segments={16}
                />
                <span className="hud-value w-9 text-right text-[12px]">
                  {Math.round(sel.pd * 100)}%
                </span>
              </span>
            </div>
            <p className="py-1.5 text-[11.5px] leading-4 text-muted-foreground">
              {sel.detected
                ? sel.trace > 1
                  ? "Wrong range: a second-trace echo."
                  : `True distance ${sel.range.toFixed(1)} NM.`
                : REASON_TEXT[sel.reason]}
            </p>
          </>
        )}
      </div>
    </HudPanel>
  );
}

function ControlDeck() {
  const { engine, clock } = usePsr();
  const params = usePsrState((s) => s.params);
  const env = usePsrState((s) => s.env);
  const range = usePsrState((s) => s.scopeRangeNm);
  const selectedId = usePsrState((s) => s.selectedId);
  const showCoverage = usePsrState((s) => s.showCoverage);
  const { setParam, setEnv, setScopeRange, select, setShowCoverage, resetAll } =
    usePsrState((s) => s);
  const sel = useSampled(() => {
    const a = engine.getAircraft(selectedId);
    return a
      ? {
          heading: wholeDegrees(
            a.mode.kind === "heading" ? a.targetHeadingDeg : a.headingDeg,
          ),
          speed: Math.round(a.targetSpeedKt),
          alt: Math.round(a.targetAltitudeFt),
          mode: a.mode.kind,
        }
      : null;
  }, 200);
  const ru = maxUnambiguousRangeNm(params.prfHz);
  const running = useClock(clock, (s) => s.running);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <HudPanel index="CLK" title="Time" bodyClassName="p-3">
        <ClockControls clock={clock} onReset={resetAll} />
        {!running && (
          <p className="mt-2 text-xs text-muted-foreground">
            Paused. Press Play to let the aircraft fly and the antenna turn.
          </p>
        )}
      </HudPanel>

      <HudPanel index="TX" title="Transmitter and antenna" bodyClassName="p-4">
        <div className="grid grid-cols-2 gap-x-2 gap-y-5">
          <Dial
            label="Turn time"
            value={params.rotationPeriodS}
            min={2}
            max={15}
            step={0.1}
            onChange={(v) => setParam("rotationPeriodS", v)}
            format={(v) => `${v.toFixed(1)} s`}
          />
          <Dial
            label={<Term id="prf">Pulse rate</Term>}
            value={params.prfHz}
            min={250}
            max={4000}
            step={50}
            onChange={(v) => setParam("prfHz", v)}
            format={(v) => `${v} /s`}
          />
          <Dial
            label={<Term id="beam-width">Beam width</Term>}
            value={params.beamWidthDeg}
            min={0.5}
            max={5}
            step={0.1}
            onChange={(v) => setParam("beamWidthDeg", v)}
            format={(v) => `${v.toFixed(1)}°`}
          />
          <Dial
            label="Power"
            value={Math.log10(params.peakPowerKw)}
            min={Math.log10(5)}
            max={3}
            step={0.01}
            onChange={(v) =>
              setParam("peakPowerKw", Math.round(10 ** v * 10) / 10)
            }
            format={(v) => formatPower(10 ** v)}
          />
        </div>
        <NeedleGauge
          className="mt-5"
          value={ru}
          min={0}
          max={200}
          ticks={[0, 50, 100, 150, 200]}
          label="Max unambiguous range"
          valueText={`${ru.toFixed(0)} NM`}
        />
        <Segmented
          className="mt-4"
          label="Screen range"
          value={String(range)}
          onChange={(v) => setScopeRange(Number(v))}
          options={[
            { value: "30", label: "30 NM" },
            { value: "60", label: "60 NM" },
            { value: "120", label: "120 NM" },
          ]}
        />
      </HudPanel>

      <HudPanel index="ENV" title="Out in the world" bodyClassName="px-4 py-2">
        <LeverSwitch
          label="Ground clutter"
          checked={env.groundClutter}
          onChange={(v) => setEnv("groundClutter", v)}
        />
        <LeverSwitch
          label="Rain shower"
          checked={env.rain}
          onChange={(v) => setEnv("rain", v)}
        />
        <LeverSwitch
          label="Flock of birds"
          checked={env.birds}
          onChange={(v) => setEnv("birds", v)}
        />
        <LeverSwitch
          label="Wind farm"
          checked={env.windFarm}
          onChange={(v) => setEnv("windFarm", v)}
        />
        <LeverSwitch
          label="Small aircraft far away"
          checked={env.smallFar}
          onChange={(v) => setEnv("smallFar", v)}
        />
        <LeverSwitch
          label={<Term id="mti">MTI filter</Term>}
          hint="Hides echoes that are not moving"
          tone="signal"
          checked={env.mti}
          onChange={(v) => setEnv("mti", v)}
        />
      </HudPanel>

      <HudPanel
        index="ACF"
        title="Fly an aircraft"
        bodyClassName="flex flex-col gap-4 p-4"
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="psr-aircraft" className="hud-label">
            Aircraft
          </Label>
          <Select
            value={selectedId ?? undefined}
            onValueChange={(v) => select(v)}
          >
            <SelectTrigger id="psr-aircraft" className="w-full">
              <SelectValue placeholder="Choose an aircraft" />
            </SelectTrigger>
            <SelectContent>
              {engine.aircraft.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.callsign} · {a.category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {sel && selectedId && (
          <>
            <ControlSlider
              label="Heading"
              value={sel.heading}
              min={0}
              max={359}
              onChange={(v) =>
                engine.setAircraft(selectedId, {
                  mode: { kind: "heading" },
                  targetHeadingDeg: normalize360(v),
                })
              }
              format={(v) => `${String(v).padStart(3, "0")}°`}
              hint={
                sel.mode === "route"
                  ? "Following its route. Move this to take control."
                  : undefined
              }
            />
            <ControlSlider
              label="Speed"
              value={sel.speed}
              min={60}
              max={500}
              step={5}
              onChange={(v) =>
                engine.setAircraft(selectedId, { targetSpeedKt: v })
              }
              format={(v) => `${v} kt`}
            />
            <ControlSlider
              label="Altitude"
              value={sel.alt}
              min={500}
              max={41000}
              step={500}
              onChange={(v) =>
                engine.setAircraft(selectedId, { targetAltitudeFt: v })
              }
              format={(v) => `${v.toLocaleString("en-US")} ft`}
            />
            <LeverSwitch
              label="Show where the radar is blind at this altitude"
              hint="On the tactical map: hills and the curve of the Earth"
              tone="signal"
              checked={showCoverage}
              onChange={setShowCoverage}
            />
          </>
        )}
        <p className="text-[12px] text-muted-foreground">
          Primary radar cannot tell you who an aircraft is or how high it flies.{" "}
          <Link
            to="/modules/ssr"
            className="inline-flex items-center gap-0.5 text-signal hover:underline"
          >
            Secondary radar fixes that{" "}
            <ArrowRight className="size-3" aria-hidden />
          </Link>
        </p>
      </HudPanel>
    </div>
  );
}
