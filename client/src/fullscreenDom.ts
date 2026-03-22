/** Cross-browser fullscreen helpers (Safari webkit prefixes). */

export function getFullscreenElement(): Element | null {
  const d = document as Document & {
    webkitFullscreenElement?: Element | null;
  };
  return document.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

export function enterFullscreen(el: HTMLElement): Promise<void> | undefined {
  const anyEl = el as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void>;
    msRequestFullscreen?: () => Promise<void>;
  };
  return (
    el.requestFullscreen?.() ??
    anyEl.webkitRequestFullscreen?.() ??
    anyEl.msRequestFullscreen?.()
  );
}

export function exitFullscreen(): Promise<void> | undefined {
  const d = document as Document & {
    webkitExitFullscreen?: () => Promise<void>;
    msExitFullscreen?: () => Promise<void>;
  };
  return (
    document.exitFullscreen?.() ??
    d.webkitExitFullscreen?.() ??
    d.msExitFullscreen?.()
  );
}
