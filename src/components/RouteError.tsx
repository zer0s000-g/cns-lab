import { useEffect } from "react";
import { Link, isRouteErrorResponse, useRouteError } from "react-router";
import { ArrowLeft, RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CornerBrackets } from "@/hud/HudFrame";
import { isChunkLoadError, resetFailedLazies } from "@/lib/lazyRetry";

/** Shown in place of a page that failed to load or crashed. The header and footer stay. */
export function RouteError() {
  const error = useRouteError();
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  const stale = !offline && isChunkLoadError(error);
  const status = isRouteErrorResponse(error) ? error.status : undefined;
  if (import.meta.env.DEV) console.error(error);
  // The page that failed is no longer rendered: reopening it downloads it again.
  useEffect(() => resetFailedLazies(), [error]);
  return (
    <div className="mx-auto max-w-[760px] px-4 py-20 md:px-10">
      <div className="relative px-6 py-10 md:px-10">
        <CornerBrackets inset={0} />
        <p className="hud-label mb-3 flex items-center gap-2 text-destructive">
          <TriangleAlert className="size-3.5" aria-hidden />
          {offline
            ? "Offline"
            : stale
              ? "Download failed"
              : status
                ? `Error ${status}`
                : "Something went wrong"}
        </p>
        <h1 className="hud-title text-[24px] leading-8 text-foreground md:text-[30px]">
          {offline
            ? "You are offline"
            : stale
              ? "Part of this page could not be downloaded"
              : "This page could not load"}
        </h1>
        <p className="mt-3 max-w-[56ch] text-[15px] leading-7 text-muted-foreground">
          {offline
            ? "This page has not been saved for offline use yet. Pages you have opened while online keep working offline. Reconnect and reload to open this one."
            : stale
              ? "The connection may have dropped, or CNS Lab was updated and this part of the page moved. Reloading fetches it again."
              : "The simulation hit an unexpected problem. Reloading usually fixes it. If it keeps happening, try another module and come back later."}
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={() => window.location.reload()}>
            <RotateCw aria-hidden /> Reload
          </Button>
          <Button asChild variant="outline">
            <Link to="/">
              <ArrowLeft aria-hidden /> Back to CNS Lab
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
