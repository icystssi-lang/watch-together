import type { CreateAdapterOptions, VideoAdapter } from "./types";

export async function createIframeAdapter(
  opts: CreateAdapterOptions
): Promise<VideoAdapter> {
  return {
    provider: "iframe",

    setSuppressEmit() {},

    mount(container: HTMLElement) {
      container.innerHTML = "";
      const iframe = document.createElement("iframe");
      iframe.src = opts.source;
      iframe.style.width = "100%";
      iframe.style.height = "100%";
      iframe.style.border = "0";
      iframe.allowFullscreen = true;
      iframe.setAttribute(
        "allow",
        "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
      );
      container.appendChild(iframe);
    },

    destroy() {},

    async applySeek() {},
    async applyPlay() {},
    async applyPause() {},
  };
}
