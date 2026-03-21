import Player from "@vimeo/player";
import type { CreateAdapterOptions, VideoAdapter } from "./types";

export async function createVimeoAdapter(
  opts: CreateAdapterOptions
): Promise<VideoAdapter> {
  let suppress = false;
  let player: Player | null = null;

  return {
    provider: "vimeo",

    setSuppressEmit(value: boolean) {
      suppress = value;
    },

    mount(container: HTMLElement) {
      container.innerHTML = "";
      const div = document.createElement("div");
      div.style.width = "100%";
      div.style.height = "100%";
      container.appendChild(div);

      const id = Number(opts.source);
      if (!Number.isFinite(id)) throw new Error("Invalid Vimeo id");

      player = new Player(div, { id });

      player.on("play", async () => {
        if (suppress || !player) return;
        const time = await player.getCurrentTime();
        opts.onUserEvent({ type: "play", time });
      });
      player.on("pause", async () => {
        if (suppress || !player) return;
        const time = await player.getCurrentTime();
        opts.onUserEvent({ type: "pause", time });
      });
      player.on("seeked", async () => {
        if (suppress || !player) return;
        const time = await player.getCurrentTime();
        opts.onUserEvent({ type: "seek", time });
      });
    },

    destroy() {
      if (player) {
        void player.destroy().catch(() => {});
      }
      player = null;
    },

    async applySeek(time: number) {
      if (!player) return;
      await player.setCurrentTime(time);
    },

    async applyPlay(time: number) {
      if (!player) return;
      await player.setCurrentTime(time);
      await player.play().catch(() => {});
    },

    async applyPause(time: number) {
      if (!player) return;
      await player.setCurrentTime(time);
      await player.pause().catch(() => {});
    },
  };
}
