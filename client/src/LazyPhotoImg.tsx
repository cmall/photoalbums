import { useEffect, useRef, useState } from "react";

const MAX_CONCURRENT = 8;
let activeLoads = 0;
const loadWaiters: Array<() => void> = [];

function acquireLoadSlot(): Promise<() => void> {
  if (activeLoads < MAX_CONCURRENT) {
    activeLoads++;
    return Promise.resolve(releaseLoadSlot);
  }
  return new Promise((resolve) => {
    loadWaiters.push(() => {
      activeLoads++;
      resolve(releaseLoadSlot);
    });
  });
}

function releaseLoadSlot() {
  activeLoads--;
  loadWaiters.shift()?.();
}

export function LazyPhotoImg({
  src,
  alt = "",
  className,
}: {
  src: string;
  alt?: string;
  className?: string;
}) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const retryRef = useRef(0);
  const releaseRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    setLoadedSrc(null);
    setFailed(false);
    retryRef.current = 0;

    let cancelled = false;
    void (async () => {
      const release = await acquireLoadSlot();
      if (cancelled) {
        release();
        return;
      }
      releaseRef.current = release;
      setLoadedSrc(src);
    })();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      releaseRef.current?.();
      releaseRef.current = null;
    };
  }, [src]);

  function finishLoad() {
    releaseRef.current?.();
    releaseRef.current = null;
  }

  if (!loadedSrc) {
    return <div className={"photo-img-placeholder" + (className ? ` ${className}` : "")} aria-hidden />;
  }

  return (
    <img
      src={loadedSrc}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      onLoad={finishLoad}
      onError={() => {
        if (retryRef.current < 2) {
          retryRef.current++;
          window.setTimeout(() => {
            if (!mountedRef.current) return;
            const sep = src.includes("?") ? "&" : "?";
            setLoadedSrc(`${src}${sep}retry=${retryRef.current}`);
          }, 1500 * retryRef.current);
          return;
        }
        finishLoad();
        setFailed(true);
      }}
      style={failed ? { opacity: 0.35 } : undefined}
    />
  );
}
