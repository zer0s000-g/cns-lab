import { Suspense, useEffect } from 'react'
import { lazyRetry } from '@/lib/lazyRetry'
import { createBrowserRouter, Outlet, RouterProvider, ScrollRestoration, useLocation, useMatch } from 'react-router'
import { MDXProvider } from '@mdx-js/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { PageFallback } from '@/components/PageFallback'
import { SiteFooter } from '@/components/SiteFooter'
import { SiteHeader } from '@/components/SiteHeader'
import { mdxComponents } from '@/components/mdx'
import { MODULE_BY_ID } from '@/modules/registry'
import { applyTheme, usePrefs } from '@/stores/prefs'
import Home from '@/pages/Home'
import ModulePage from '@/pages/ModulePage'
import NotFound from '@/pages/NotFound'
import { RouteError } from '@/components/RouteError'

const Glossary = lazyRetry(() => import('@/pages/Glossary'))
const Frequencies = lazyRetry(() => import('@/pages/Frequencies'))
const SandboxRoute = lazyRetry(() => import('@/pages/SandboxRoute'))

function useThemeSync() {
  const theme = usePrefs((s) => s.theme)
  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])
}

function Shell() {
  useThemeSync()
  const match = useMatch('/modules/:id')
  const sandbox = useMatch('/sandbox')
  const location = useLocation()
  const module = match?.params.id ? MODULE_BY_ID.get(match.params.id) : sandbox ? MODULE_BY_ID.get('sandbox') : undefined
  useEffect(() => {
    document.title = module ? `${module.name} · CNS Lab` : 'CNS Lab — How air traffic management equipment works'
  }, [module, location.pathname])
  return (
    <TooltipProvider delayDuration={300}>
      <MDXProvider components={mdxComponents}>
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          Skip to content
        </a>
        <div className="flex min-h-dvh flex-col">
          <SiteHeader module={module} />
          <main id="main" className="flex-1">
            <Suspense fallback={<PageFallback />}>
              <Outlet />
            </Suspense>
          </main>
          <SiteFooter />
        </div>
        <ScrollRestoration />
      </MDXProvider>
    </TooltipProvider>
  )
}

const router = createBrowserRouter(
  [
    {
      element: <Shell />,
      children: [
        {
          // Errors render inside the shell, so the header and footer stay.
          errorElement: <RouteError />,
          children: [
            { path: '/', element: <Home /> },
            { path: '/modules/:id', element: <ModulePage /> },
            { path: '/sandbox', element: <SandboxRoute /> },
            { path: '/glossary', element: <Glossary /> },
            { path: '/frequencies', element: <Frequencies /> },
            { path: '*', element: <NotFound /> },
          ],
        },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || undefined },
)

export default function App() {
  return <RouterProvider router={router} />
}
