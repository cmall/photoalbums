import { useState } from "react";

/** Thumbnail with lazy load and retry (handles cache still warming). */
export function PhotoThumb({ src, className }: { src: string; className?: string }) {
  const [retry, setRetry] = useState(0);
  const url =
    retry > 0 ? `${src}${src.includes("?") ? "&" : "?"}_r=${retry}` : src;

  return (
    <img
      src={url}
      alt=""
      className={className}
      loading="lazy"
      decoding="async"
      onError={() => {
        if (retry < 4) {
          window.setTimeout(() => setRetry((n) => n + 1), 1500 + retry * 500);
        }
      }}
    />
  );
}
