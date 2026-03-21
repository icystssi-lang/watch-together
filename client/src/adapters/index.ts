import type { VideoProvider } from "../resolveVideoUrl";
import type { CreateAdapterOptions, VideoAdapter } from "./types";
import { createHtml5Adapter } from "./html5Adapter";
import { createIframeAdapter } from "./iframeAdapter";
import { createVimeoAdapter } from "./vimeoAdapter";
import { createYoutubeAdapter } from "./youtubeAdapter";

export function createVideoAdapter(
  provider: VideoProvider,
  opts: CreateAdapterOptions
): Promise<VideoAdapter> {
  switch (provider) {
    case "youtube":
      return createYoutubeAdapter(opts);
    case "vimeo":
      return createVimeoAdapter(opts);
    case "html5":
      return createHtml5Adapter(opts);
    case "iframe":
      return createIframeAdapter(opts);
    default: {
      const _exhaustive: never = provider;
      return Promise.reject(new Error(`Unknown provider: ${_exhaustive}`));
    }
  }
}

export type { VideoAdapter, CreateAdapterOptions, UserVideoEvent } from "./types";
