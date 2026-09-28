import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { usePrefs, useReducedMotion, type ThemeChoice } from '@/stores/prefs'

/** Theme, sound, captions and motion preferences. */
export function ThemeToggle() {
  const theme = usePrefs((s) => s.theme)
  const setTheme = usePrefs((s) => s.setTheme)
  const soundOn = usePrefs((s) => s.soundOn)
  const setSoundOn = usePrefs((s) => s.setSoundOn)
  const captionsOn = usePrefs((s) => s.captionsOn)
  const setCaptionsOn = usePrefs((s) => s.setCaptionsOn)
  const reduced = useReducedMotion()
  const setReduced = usePrefs((s) => s.setReducedMotion)
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Display and sound settings">
          <Icon className="size-5" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemeChoice)}>
          <DropdownMenuRadioItem value="light">
            <Sun aria-hidden /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon aria-hidden /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor aria-hidden /> Same as device
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Accessibility</DropdownMenuLabel>
        <DropdownMenuCheckboxItem checked={soundOn} onCheckedChange={(v) => setSoundOn(Boolean(v))}>
          Sound
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={captionsOn} onCheckedChange={(v) => setCaptionsOn(Boolean(v))}>
          Sound captions
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={reduced} onCheckedChange={(v) => setReduced(Boolean(v))}>
          Reduce motion
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
