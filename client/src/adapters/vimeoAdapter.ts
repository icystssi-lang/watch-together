import Player from "@vimeo/player";
import { createEmitCooldown } from "./emitCooldown";
import type { CreateAdapterOptions, VideoAdapter } from "./types";

export async function createVimeoAdapter(
  opts: CreateAdapterOptions
): Promise<VideoAdapter> {
  let suppress = false;
  const emitCooldown = createEmitCooldown(350);
  let player: Player | null = null;

  return {
    provider: "vimeo",

    setSuppressEmit(value: boolean) {
      suppress = value;
    },

    mount(container: HTMLElement) {
      container.innerHTML = "";
      if (opts.audioOnly) {
        const note = document.createElement("div");
        note.className = "synced-player-placeholder";
        note.textContent = "Audio-only mode: Vimeo video is hidden.";
        container.appendChild(note);
      }
      const div = document.createElement("div");
      div.style.width = opts.audioOnly ? "1px" : "100%";
      div.style.height = opts.audioOnly ? "1px" : "100%";
      div.style.opacity = opts.audioOnly ? "0.01" : "1";
      div.style.pointerEvents = opts.audioOnly ? "none" : "auto";
      container.appendChild(div);

      const id = Number(opts.source);
      if (!Number.isFinite(id)) throw new Error("Invalid Vimeo id");

      player = new Player(div, { id });

      player.on("play", async () => {
        if (suppress || emitCooldown.isActive() || !player) return;
        const time = await player.getCurrentTime();
        opts.onUserEvent({ type: "play", time });
      });
      player.on("pause", async () => {
        if (suppress || emitCooldown.isActive() || !player) return;
        const time = await player.getCurrentTime();
        opts.onUserEvent({ type: "pause", time });
      });
      player.on("seeked", async () => {
        if (suppress || emitCooldown.isActive() || !player) return;
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
      emitCooldown.bump();
    },

    async applyPlay(time: number) {
      if (!player) return;
      await player.setCurrentTime(time);
      await player.play().catch(() => {});
      emitCooldown.bump();
    },

    async applyPause(time: number) {
      if (!player) return;
      await player.setCurrentTime(time);
      await player.pause().catch(() => {});
      emitCooldown.bump();
    },
  };
}
