import type { CreateAdapterOptions, VideoAdapter } from "./types";

export async function createHtml5Adapter(
  opts: CreateAdapterOptions
): Promise<VideoAdapter> {
  let suppress = false;
  let video: HTMLVideoElement | null = null;

  return {
    provider: "html5",

    setSuppressEmit(value: boolean) {
      suppress = value;
    },

    mount(container: HTMLElement) {
      container.innerHTML = "";
      const el = document.createElement("video");
      el.controls = true;
      el.playsInline = true;
      el.style.width = "100%";
      el.style.height = "100%";
      el.src = opts.source;
      el.crossOrigin = "anonymous";

      const onPlay = () => {
        if (suppress || !video) return;
        opts.onUserEvent({ type: "play", time: video.currentTime });
      };
      const onPause = () => {
        if (suppress || !video) return;
        opts.onUserEvent({ type: "pause", time: video.currentTime });
      };
      const onSeeked = () => {
        if (suppress || !video) return;
        opts.onUserEvent({ type: "seek", time: video.currentTime });
      };

      el.addEventListener("play", onPlay);
      el.addEventListener("pause", onPause);
      el.addEventListener("seeked", onSeeked);

      video = el;
      container.appendChild(el);
    },

    destroy() {
      video?.pause();
      video?.remove();
      video = null;
    },

    async applySeek(time: number) {
      if (!video) return;
      video.currentTime = time;
    },

    async applyPlay(time: number) {
      if (!video) return;
      video.currentTime = time;
      await video.play().catch(() => {});
    },

    async applyPause(time: number) {
      if (!video) return;
      video.currentTime = time;
      video.pause();
    },
  };
}
