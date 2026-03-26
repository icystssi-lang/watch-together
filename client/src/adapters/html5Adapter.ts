import { createEmitCooldown } from "./emitCooldown";
import type { CreateAdapterOptions, VideoAdapter } from "./types";

export async function createHtml5Adapter(
  opts: CreateAdapterOptions
): Promise<VideoAdapter> {
  let suppress = false;
  const emitCooldown = createEmitCooldown(350);
  let media: HTMLMediaElement | null = null;

  return {
    provider: "html5",

    setSuppressEmit(value: boolean) {
      suppress = value;
    },

    mount(container: HTMLElement) {
      container.innerHTML = "";
      const el = opts.audioOnly
        ? document.createElement("audio")
        : document.createElement("video");
      el.controls = true;
      el.playsInline = true;
      el.style.width = "100%";
      if (!opts.audioOnly) {
        el.style.height = "100%";
      }
      el.src = opts.source;
      el.crossOrigin = "anonymous";

      const onPlay = () => {
        if (suppress || emitCooldown.isActive() || !media) return;
        opts.onUserEvent({ type: "play", time: media.currentTime });
      };
      const onPause = () => {
        if (suppress || emitCooldown.isActive() || !media) return;
        opts.onUserEvent({ type: "pause", time: media.currentTime });
      };
      const onSeeked = () => {
        if (suppress || emitCooldown.isActive() || !media) return;
        opts.onUserEvent({ type: "seek", time: media.currentTime });
      };

      el.addEventListener("play", onPlay);
      el.addEventListener("pause", onPause);
      el.addEventListener("seeked", onSeeked);

      media = el;
      container.appendChild(el);
    },

    destroy() {
      media?.pause();
      media?.remove();
      media = null;
    },

    async applySeek(time: number) {
      if (!media) return;
      media.currentTime = time;
      emitCooldown.bump();
    },

    async applyPlay(time: number) {
      if (!media) return;
      media.currentTime = time;
      await media.play().catch(() => {});
      emitCooldown.bump();
    },

    async applyPause(time: number) {
      if (!media) return;
      media.currentTime = time;
      media.pause();
      emitCooldown.bump();
    },
  };
}
