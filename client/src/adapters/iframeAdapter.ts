import type { CreateAdapterOptions, VideoAdapter } from "./types";

export async function createIframeAdapter(
  opts: CreateAdapterOptions
): Promise<VideoAdapter> {
  return {
    provider: "iframe",

    setSuppressEmit() {},

    mount(container: HTMLElement) {
      container.innerHTML = "";
      if (opts.audioOnly) {
        const note = document.createElement("div");
        note.className = "synced-player-placeholder";
        note.textContent =
          "Audio-only mode is limited for generic embeds. Use direct media links for best results.";
        container.appendChild(note);
      }
      const iframe = document.createElement("iframe");
      iframe.src = opts.source;
      iframe.style.width = opts.audioOnly ? "1px" : "100%";
      iframe.style.height = opts.audioOnly ? "1px" : "100%";
      iframe.style.opacity = opts.audioOnly ? "0.01" : "1";
      iframe.style.pointerEvents = opts.audioOnly ? "none" : "auto";
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
