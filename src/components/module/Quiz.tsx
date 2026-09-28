import { useId, useState } from 'react'
import { ArrowRight, CircleCheck, CircleX, RotateCcw, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
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
      <div className="flex flex-col items-start gap-4 rounded-lg border bg-card p-6">
        <span className="grid size-10 place-items-center rounded-md bg-accent text-accent-foreground">
          <Trophy className="size-5" aria-hidden />
        </span>
        <div>
          <h3 className="text-base font-semibold">
            You scored <span className="tabular-nums">{score}</span> out of <span className="tabular-nums">{questions.length}</span>
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {score === questions.length
              ? 'Perfect. You clearly understand how this system works.'
              : score >= questions.length - 2
                ? 'Nicely done. Revisit the simulator for the ones you missed.'
                : 'Good start. Try the experiments again, then have another go.'}{' '}
            This module is now marked as completed on the home page.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={restart}>
          <RotateCcw aria-hidden /> Try again
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-card p-4 md:p-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs font-medium text-muted-foreground tabular-nums">
          Question {index + 1} of {questions.length}
        </p>
        {best?.completed && (
          <p className="text-xs text-muted-foreground tabular-nums">
            Best score {best.bestScore}/{best.total}
          </p>
        )}
      </div>
      <Progress value={((index + (checked ? 1 : 0)) / questions.length) * 100} aria-label="Quiz progress" />
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-[15px] leading-6 font-semibold">{q.question}</legend>
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
                  'flex min-h-10 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm font-normal hover:bg-muted/60',
                  String(k) === choice && !checked && 'border-primary bg-accent',
                  isAnswer && 'border-success bg-success/10',
                  isWrongPick && 'border-destructive bg-destructive/10',
                  checked && 'cursor-default',
                )}
              >
                <RadioGroupItem id={id} value={String(k)} disabled={checked && String(k) !== choice} />
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
          className={cn('rounded-md border-l-2 px-3 py-2 text-sm', correct ? 'border-success bg-success/10' : 'border-destructive bg-destructive/10')}
        >
          <p className="font-semibold">{correct ? 'Correct!' : 'Not quite.'}</p>
          <p className="mt-1 leading-relaxed">{q.explanation}</p>
        </div>
      )}
      <div className="flex justify-end">
        {!checked ? (
          <Button size="sm" onClick={check} disabled={choice === ''}>
            Check answer
          </Button>
        ) : (
          <Button size="sm" onClick={next}>
            {index === questions.length - 1 ? 'See my score' : 'Next question'} <ArrowRight aria-hidden />
          </Button>
        )}
      </div>
    </div>
  )
}
