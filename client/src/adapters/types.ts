import type { VideoProvider } from "../resolveVideoUrl";

export type UserVideoEvent =
  | { type: "load"; provider: VideoProvider; source: string }
  | { type: "play"; time: number }
  | { type: "pause"; time: number }
  | { type: "seek"; time: number };

export interface VideoAdapter {
  readonly provider: VideoProvider;
  mount(container: HTMLElement): void;
  destroy(): void;
  setSuppressEmit(value: boolean): void;
  applyPlay(time: number): Promise<void>;
  applyPause(time: number): Promise<void>;
  applySeek(time: number): Promise<void>;
}

export type CreateAdapterOptions = {
  source: string;
  audioOnly?: boolean;
  onUserEvent: (e: UserVideoEvent) => void;
};

export type AdapterFactory = (
  opts: CreateAdapterOptions
) => Promise<VideoAdapter>;
