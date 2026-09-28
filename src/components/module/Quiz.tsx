import { useId, useState } from 'react'
import { ArrowRight, CircleCheck, CircleX, RotateCcw, Trophy } from 'lucide-react'
import { HudButton } from '@/hud/Controls'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useProgress } from '@/stores/progress'
import { cn } from '@/lib/utils'

export interface QuizQuestion {
  question: string
  options: string[]
  /** Index of the correct option. */
  answer: number
  /** Friendly explanation shown after answering. */
  explanation: string
}

/** Quick quiz: one question at a time, friendly explanations, progress saved locally. */
export function Quiz({ moduleId, questions }: { moduleId: string; questions: QuizQuestion[] }) {
  const [index, setIndex] = useState(0)
  const [choice, setChoice] = useState<string>('')
  const [checked, setChecked] = useState(false)
  const [score, setScore] = useState(0)
  const [done, setDone] = useState(false)
  const record = useProgress((s) => s.recordQuiz)
  const best = useProgress((s) => s.modules[moduleId])
  const baseId = useId()

  const q = questions[index]
  const correct = checked && Number(choice) === q.answer

  const check = () => {
    if (choice === '') return
    setChecked(true)
    if (Number(choice) === q.answer) setScore((s) => s + 1)
  }
  const next = () => {
    if (index === questions.length - 1) {
      setDone(true)
      record(moduleId, score, questions.length)
      return
    }
    setIndex((i) => i + 1)
    setChoice('')
    setChecked(false)
  }
  const restart = () => {
    setIndex(0)
    setChoice('')
    setChecked(false)
    setScore(0)
    setDone(false)
  }

  if (done) {
    return (
      <div className="flex flex-col items-start gap-4">
        <Trophy className="size-6 text-brass" aria-hidden />
        <div>
          <p className="hud-label">Result</p>
          <h3 className="hud-title mt-1 text-[22px] text-foreground">
            <span className="hud-value text-signal">{score}</span> / <span className="hud-value">{questions.length}</span>
          </h3>
          <p className="mt-2 max-w-prose text-[14px] leading-6 text-foreground/80">
            {score === questions.length
              ? 'Perfect. You clearly understand how this system works.'
              : score >= questions.length - 2
                ? 'Nicely done. Revisit the simulator for the ones you missed.'
                : 'Good start. Try the experiments again, then have another go.'}{' '}
            This module is now marked as completed on the home page.
          </p>
        </div>
        <HudButton onClick={restart}>
          <RotateCcw aria-hidden /> Try again
        </HudButton>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="hud-label">
          Question {String(index + 1).padStart(2, '0')} / {String(questions.length).padStart(2, '0')}
        </p>
        {best?.completed && (
          <p className="hud-label">
            Best score {best.bestScore}/{best.total}
          </p>
        )}
      </div>
      <div className="flex gap-1" role="progressbar" aria-label="Quiz progress" aria-valuemin={0} aria-valuemax={questions.length} aria-valuenow={index + (checked ? 1 : 0)}>
        {questions.map((_, k) => (
          <span key={k} className={cn('h-[3px] flex-1', k < index + (checked ? 1 : 0) ? 'bg-signal' : 'bg-foreground/15')} />
        ))}
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-[17px] leading-7 font-medium text-foreground">{q.question}</legend>
        <RadioGroup value={choice} onValueChange={(v) => !checked && setChoice(v)} className="gap-2">
          {q.options.map((opt, k) => {
            const id = `${baseId}-${index}-${k}`
            const isAnswer = checked && k === q.answer
            const isWrongPick = checked && String(k) === choice && k !== q.answer
            return (
              <Label
                key={id}
                htmlFor={id}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center gap-3 rounded-[4px] border border-hud-line px-3 py-2 text-[14px] font-normal text-foreground/90 transition-colors hover:border-foreground/35 has-[button:focus-visible]:outline-2 has-[button:focus-visible]:outline-ring',
                  String(k) === choice && !checked && 'border-signal/70 bg-signal/[0.06]',
                  isAnswer && 'border-success/70 bg-success/[0.08]',
                  isWrongPick && 'border-destructive/70 bg-destructive/[0.08]',
                  checked && 'cursor-default',
                )}
              >
                <span className="hud-value w-4 text-[11px] text-muted-foreground">{String.fromCharCode(65 + k)}</span>
                <RadioGroupItem id={id} value={String(k)} disabled={checked && String(k) !== choice} className="sr-only" />
                <span className="flex-1">{opt}</span>
                {isAnswer && <CircleCheck className="size-4 shrink-0 text-success" aria-label="Correct answer" />}
                {isWrongPick && <CircleX className="size-4 shrink-0 text-destructive" aria-label="Your answer, incorrect" />}
              </Label>
            )
          })}
        </RadioGroup>
      </fieldset>
      {checked && (
        <div
          role="status"
          className={cn('border-l-2 px-4 py-3 text-[14px]', correct ? 'border-success bg-success/[0.06]' : 'border-destructive bg-destructive/[0.06]')}
        >
          <p className={cn('hud-label', correct ? 'text-success' : 'text-destructive')}>{correct ? 'Correct' : 'Not quite'}</p>
          <p className="mt-1.5 leading-6 text-foreground/90">{q.explanation}</p>
        </div>
      )}
      <div className="flex justify-end">
        {!checked ? (
          <HudButton variant="solid" onClick={check} disabled={choice === ''}>
            Check answer
          </HudButton>
        ) : (
          <HudButton variant="solid" onClick={next}>
            {index === questions.length - 1 ? 'See my score' : 'Next question'} <ArrowRight aria-hidden />
          </HudButton>
        )}
      </div>
    </div>
  )
}
