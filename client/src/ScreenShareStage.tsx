import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { getIceServers } from "./webrtc/iceServers";

export type ScreenSharePeer = { socketId: string };

type RtcPayload =
  | { type: "offer"; sdp: string }
  | { type: "answer"; sdp: string }
  | { type: "ice"; candidate: RTCIceCandidateInit };
type PeerConnState = RTCPeerConnectionState | "new";

type Props = {
  socket: Socket;
  mySocketId: string;
  hostSocketId: string;
  isHost: boolean;
  peers: ScreenSharePeer[];
  onError: (message: string) => void;
};

export function ScreenShareStage({
  socket,
  mySocketId,
  hostSocketId,
  isHost,
  peers,
  onError,
}: Props) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const hostPCsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [remoteReady, setRemoteReady] = useState(false);
  const [remoteBlocked, setRemoteBlocked] = useState(false);
  const [hostPeerStates, setHostPeerStates] = useState<Record<string, PeerConnState>>(
    {},
  );
  const [viewerConnState, setViewerConnState] = useState<PeerConnState>("new");

  useEffect(() => {
    return () => {
      for (const [, pc] of hostPCsRef.current) {
        pc.close();
      }
      hostPCsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!isHost) return;
    let cancelled = false;
    let stream: MediaStream | null = null;

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const [vt] = stream.getVideoTracks();
        if (vt) {
          vt.onended = () => {
            stream?.getTracks().forEach((t) => t.stop());
            socket.emit("unload_video");
          };
        }
        setLocalStream(stream);
      } catch (e) {
        onError(
          e instanceof Error ? e.message : "Could not capture display or tab.",
        );
        socket.emit("unload_video");
      }
    })();

    return () => {
      cancelled = true;
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      setLocalStream(null);
    };
  }, [isHost, socket, onError]);

  useEffect(() => {
    if (!isHost || !localStream) {
      if (isHost && !localStream) {
        for (const [, pc] of hostPCsRef.current) {
          pc.close();
        }
        hostPCsRef.current.clear();
        setHostPeerStates({});
      }
      return;
    }

    const hostPCs = hostPCsRef.current;
    const pendingIceByViewer = new Map<string, RTCIceCandidateInit[]>();
    const streamForPeers = localStream;
    const viewerIds = peers
      .map((p) => p.socketId)
      .filter((id) => id !== mySocketId);

    for (const [id, pc] of [...hostPCs]) {
      if (!viewerIds.includes(id)) {
        pc.close();
        hostPCs.delete(id);
        pendingIceByViewer.delete(id);
        setHostPeerStates((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    }

    const onSignal = async (msg: {
      fromSocketId: string;
      payload: RtcPayload;
    }) => {
      if (msg.fromSocketId === mySocketId) return;
      const pc = hostPCs.get(msg.fromSocketId);
      if (!pc) return;
      try {
        if (msg.payload.type === "answer") {
          await pc.setRemoteDescription({
            type: "answer",
            sdp: msg.payload.sdp,
          });
          const queued = pendingIceByViewer.get(msg.fromSocketId);
          if (queued?.length) {
            for (const candidate of queued) {
              await pc.addIceCandidate(candidate);
            }
            pendingIceByViewer.delete(msg.fromSocketId);
          }
        } else if (msg.payload.type === "ice" && msg.payload.candidate) {
          if (!pc.remoteDescription) {
            const queued = pendingIceByViewer.get(msg.fromSocketId) ?? [];
            queued.push(msg.payload.candidate);
            pendingIceByViewer.set(msg.fromSocketId, queued);
            return;
          }
          await pc.addIceCandidate(msg.payload.candidate);
        }
      } catch (err) {
        console.error(err);
      }
    };

    socket.on("rtc_signal", onSignal);

    async function addViewer(vid: string) {
      if (hostPCs.has(vid)) return;
      const pc = new RTCPeerConnection({ iceServers: getIceServers() });
      hostPCs.set(vid, pc);
      setHostPeerStates((prev) => ({ ...prev, [vid]: "connecting" }));
      streamForPeers.getTracks().forEach((t) => pc.addTrack(t, streamForPeers));
      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          socket.emit("rtc_signal", {
            targetSocketId: vid,
            payload: { type: "ice", candidate: ev.candidate.toJSON() },
          });
        }
      };
      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === "failed") {
          onError(
            "A viewer could not receive screen share. TURN may be required in production.",
          );
        }
      };
      pc.onconnectionstatechange = () => {
        setHostPeerStates((prev) => ({ ...prev, [vid]: pc.connectionState }));
        if (pc.connectionState === "failed") {
          onError("A viewer WebRTC connection failed during screen share.");
        }
      };
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const sdp = pc.localDescription?.sdp;
        if (sdp) {
          socket.emit("rtc_signal", {
            targetSocketId: vid,
            payload: { type: "offer", sdp },
          });
        }
      } catch (err) {
        console.error(err);
      }
    }

    for (const vid of viewerIds) {
      void addViewer(vid);
    }

    return () => {
      socket.off("rtc_signal", onSignal);
    };
  }, [isHost, localStream, peers, mySocketId, socket]);

  useEffect(() => {
    const v = localVideoRef.current;
    if (v && localStream) {
      v.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (isHost) return;

    setRemoteReady(false);
    setRemoteBlocked(false);
    setViewerConnState("connecting");
    const pc = new RTCPeerConnection({ iceServers: getIceServers() });
    const pendingIce: RTCIceCandidateInit[] = [];
    let disposed = false;

    const tryStartRemotePlayback = async () => {
      const el = remoteVideoRef.current;
      if (!el || disposed || !el.srcObject) return;
      try {
        await el.play();
        if (!disposed) {
          setRemoteReady(true);
          setRemoteBlocked(false);
        }
      } catch {
        if (!disposed) {
          setRemoteBlocked(true);
          onError("Browser blocked autoplay. Click the video area to start playback.");
        }
      }
    };

    pc.ontrack = (ev) => {
      const el = remoteVideoRef.current;
      const incomingTrack = ev.track;
      if (!el || !incomingTrack || incomingTrack.kind !== "video" || !ev.streams[0]) {
        return;
      }
      const stream = ev.streams[0];
      el.srcObject = stream;
      if (!incomingTrack.muted) {
        void tryStartRemotePlayback();
      } else {
        incomingTrack.onunmute = () => {
          incomingTrack.onunmute = null;
          void tryStartRemotePlayback();
        };
      }
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        socket.emit("rtc_signal", {
          targetSocketId: hostSocketId,
          payload: { type: "ice", candidate: ev.candidate.toJSON() },
        });
      }
    };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") {
        onError("Screen share connection failed. TURN may be required in production.");
      }
    };
    pc.onconnectionstatechange = () => {
      setViewerConnState(pc.connectionState);
      if (pc.connectionState === "failed") {
        onError("WebRTC connection failed. Ask host to restart sharing.");
      }
    };

    const onSignal = async (msg: {
      fromSocketId: string;
      payload: RtcPayload;
    }) => {
      if (msg.fromSocketId !== hostSocketId) return;
      try {
        if (msg.payload.type === "offer") {
          await pc.setRemoteDescription({
            type: "offer",
            sdp: msg.payload.sdp,
          });
          if (pendingIce.length) {
            for (const candidate of pendingIce) {
              await pc.addIceCandidate(candidate);
            }
            pendingIce.length = 0;
          }
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          const sdp = pc.localDescription?.sdp;
          if (sdp) {
            socket.emit("rtc_signal", {
              targetSocketId: hostSocketId,
              payload: { type: "answer", sdp },
            });
          }
        } else if (msg.payload.type === "ice" && msg.payload.candidate) {
          if (!pc.remoteDescription) {
            pendingIce.push(msg.payload.candidate);
            return;
          }
          await pc.addIceCandidate(msg.payload.candidate);
        }
      } catch (err) {
        console.error(err);
      }
    };

    socket.on("rtc_signal", onSignal);

    return () => {
      disposed = true;
      socket.off("rtc_signal", onSignal);
      pc.close();
      setRemoteReady(false);
      setRemoteBlocked(false);
      setViewerConnState("new");
      const el = remoteVideoRef.current;
      if (el) el.srcObject = null;
    };
  }, [isHost, hostSocketId, onError, socket]);

  function badgeColors(state: PeerConnState): { bg: string; border: string } {
    if (state === "connected") return { bg: "#16361f", border: "#2e7d32" };
    if (state === "failed" || state === "disconnected") {
      return { bg: "#3a1c1c", border: "#b3261e" };
    }
    return { bg: "#1f2430", border: "#4f5b76" };
  }

  function stopSharing() {
    localStream?.getTracks().forEach((t) => t.stop());
    setLocalStream(null);
    for (const [, pc] of hostPCsRef.current) {
      pc.close();
    }
    hostPCsRef.current.clear();
    socket.emit("unload_video");
  }

  if (isHost) {
    const peerStateValues = Object.values(hostPeerStates);
    const connectedCount = peerStateValues.filter((s) => s === "connected").length;
    const connectingCount = peerStateValues.filter((s) => s === "connecting").length;
    const failedCount = peerStateValues.filter(
      (s) => s === "failed" || s === "disconnected",
    ).length;
    return (
      <div className="synced-player-wrap">
        {!localStream && (
          <div className="synced-player-placeholder">
            Starting screen capture…
          </div>
        )}
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            display: localStream ? "block" : "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            fontSize: 12,
            padding: "4px 8px",
            borderRadius: 999,
            background:
              failedCount > 0
                ? "#3a1c1c"
                : connectingCount > 0
                  ? "#1f2430"
                  : "#16361f",
            border: "1px solid #4f5b76",
          }}
        >
          {`Peers: ${connectedCount} connected`}
          {connectingCount > 0 ? `, ${connectingCount} connecting` : ""}
          {failedCount > 0 ? `, ${failedCount} failed` : ""}
        </div>
        <div
          style={{
            position: "absolute",
            bottom: 8,
            left: 8,
            right: 8,
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <span className="muted small" style={{ flex: 1, minWidth: 120 }}>
            Sharing includes audio when the browser offers it (e.g. Chrome: pick a
            tab and check &quot;Share tab audio&quot;).
          </span>
          <button type="button" onClick={stopSharing}>
            Stop sharing
          </button>
        </div>
      </div>
    );
  }

  const viewerBadge = badgeColors(viewerConnState);
  return (
    <div className="synced-player-wrap">
      <div
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          fontSize: 12,
          padding: "4px 8px",
          borderRadius: 999,
          background: viewerBadge.bg,
          border: `1px solid ${viewerBadge.border}`,
        }}
      >
        {`WebRTC: ${viewerConnState}`}
      </div>
      {!remoteReady && (
        <div className="synced-player-placeholder">
          Waiting for host video…
        </div>
      )}
      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        muted={false}
        controls={remoteBlocked}
        onClick={() => {
          const el = remoteVideoRef.current;
          if (!el || !el.srcObject) return;
          void el.play().then(
            () => {
              setRemoteReady(true);
              setRemoteBlocked(false);
            },
            () => {
              onError("Playback is still blocked by the browser. Use the play control.");
            },
          );
        }}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          display: remoteReady ? "block" : "none",
        }}
      />
    </div>
  );
}
