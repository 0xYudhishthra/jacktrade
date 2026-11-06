import { useEffect, useRef } from "react";
import nightVideo from "@/assets/login-nyc-night.mp4";

export default function LoginVideoBackdrop() {
  const videoRef = useRef(null);

  // Respect reduced motion: keep the first frame as a still wallpaper.
  useEffect(() => {
    const video = videoRef.current;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      if (!video) return;
      if (query.matches) video.pause();
      else video.play().catch(() => {});
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return (
    <div className="hm-signin-wallpaper hm-signin-video" aria-hidden="true">
      <video ref={videoRef} src={nightVideo} autoPlay muted loop playsInline preload="auto" />
    </div>
  );
}
