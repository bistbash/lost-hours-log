import React, { useCallback, useEffect, useRef, useState } from "react";

const FADE_MS = 700;
const START_MS = 4000; // On a slow connection, skip the intro rather than wait for the video.
const MAX_MS = 9000; // Never keep the system hidden longer than this, even if the video stalls.

/** Some browsers (Safari) play this video without its transparency, on a solid square. */
function isOpaque(video) {
  try {
    const probe = document.createElement("canvas");
    probe.width = probe.height = 1;
    const ctx = probe.getContext("2d");
    ctx.drawImage(video, 0, 0, 8, 8, 0, 0, 1, 1); // The corner is empty in the transparent video.
    return ctx.getImageData(0, 0, 1, 1).data[3] > 8;
  } catch {
    return false;
  }
}

/** The animated logo (a transparent video) over a blurred view of the system, on every load. A click or a key skips it. */
export default function Intro() {
  const [phase, setPhase] = useState("play"); // play | leaving | done
  const [ready, setReady] = useState(false);
  const videoRef = useRef(null);

  const leave = useCallback(() => setPhase((p) => (p === "play" ? "leaving" : p)), []);

  useEffect(() => {
    // The page behind is blurred while the logo plays, and sharpens as the intro fades out.
    document.documentElement.classList.toggle("thc-intro-on", phase === "play");
    return () => document.documentElement.classList.remove("thc-intro-on");
  }, [phase]);

  useEffect(() => {
    if (phase === "play") {
      const limit = setTimeout(leave, MAX_MS);
      window.addEventListener("keydown", leave);
      return () => { clearTimeout(limit); window.removeEventListener("keydown", leave); };
    }
    if (phase === "leaving") {
      const done = setTimeout(() => setPhase("done"), FADE_MS);
      return () => clearTimeout(done);
    }
    return undefined;
  }, [phase, leave]);

  useEffect(() => {
    if (ready) return undefined;
    const limit = setTimeout(leave, START_MS);
    return () => clearTimeout(limit);
  }, [ready, leave]);

  useEffect(() => {
    // Autoplay can be refused (e.g. power saving); then skip rather than show a frozen frame.
    videoRef.current?.play?.()?.catch(() => leave());
  }, [leave]);

  const onFirstFrame = (e) => {
    if (isOpaque(e.currentTarget)) leave();
    else setReady(true);
  };

  if (phase === "done") return null;
  return (
    <div
      className={`thc-intro ${phase === "leaving" ? "is-leaving" : ""}`}
      onClick={leave}
      role="presentation"
      aria-hidden="true"
    >
      <video
        ref={videoRef}
        className={`thc-intro-logo ${ready ? "is-ready" : ""}`}
        src="/intro.webm"
        muted
        autoPlay
        playsInline
        preload="auto"
        onLoadedData={onFirstFrame}
        onEnded={leave}
        onError={leave}
      />
    </div>
  );
}
