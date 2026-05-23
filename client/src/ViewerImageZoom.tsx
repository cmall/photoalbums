import type { ReactNode, RefObject } from "react";
import { useCallback, useEffect, useRef } from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import type { ReactZoomPanPinchContentRef } from "react-zoom-pan-pinch";

const MAX_SCALE = 5;
const MIN_SCALE_FLOOR = 0.05;

function fitView(
  ref: ReactZoomPanPinchContentRef | null | undefined,
  img?: HTMLImageElement | null,
): number {
  if (!ref) return 1;
  const wrapper = img?.closest(".viewer-img-wrap") as HTMLElement | null;
  if (img?.complete && img.naturalWidth > 0 && img.naturalHeight > 0 && wrapper) {
    const cw = wrapper.clientWidth;
    const ch = wrapper.clientHeight;
    if (cw > 0 && ch > 0) {
      const scale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight, 1);
      ref.centerView(scale, 0);
      return scale;
    }
  }
  ref.centerView(1, 0);
  return 1;
}

export function ViewerImageZoom({
  resetKey,
  interactionDisabled,
  onScaleChange,
  transformRef,
  imageRef,
  onBackgroundClick,
  tagging,
  header,
  children,
}: {
  resetKey: string;
  interactionDisabled: boolean;
  onScaleChange: (scale: number) => void;
  transformRef?: RefObject<ReactZoomPanPinchContentRef | null>;
  imageRef?: RefObject<HTMLImageElement | null>;
  onBackgroundClick?: () => void;
  tagging?: boolean;
  /** Album prev/next controls — rendered left of zoom on the top toolbar row. */
  header?: ReactNode;
  children: ReactNode;
}) {
  const fitScaleRef = useRef(1);

  const applyFit = useCallback(() => {
    const scale = fitView(transformRef?.current, imageRef?.current);
    fitScaleRef.current = scale;
    onScaleChange(scale);
  }, [transformRef, imageRef, onScaleChange]);

  useEffect(() => {
    fitScaleRef.current = 1;
    applyFit();
  }, [resetKey, applyFit]);

  useEffect(() => {
    const img = imageRef?.current;
    if (!img) return;
    const run = () => applyFit();
    img.addEventListener("load", run);
    if (img.complete) run();
    return () => img.removeEventListener("load", run);
  }, [resetKey, imageRef, applyFit]);

  return (
    <div className="viewer-zoom-stack">
      <TransformWrapper
        key={resetKey}
        ref={transformRef}
        initialScale={1}
        initialPositionX={0}
        initialPositionY={0}
        minScale={MIN_SCALE_FLOOR}
        maxScale={MAX_SCALE}
        centerOnInit
        centerZoomedOut
        limitToBounds
        smooth
        wheel={{ step: 0.12, disabled: interactionDisabled }}
        panning={{ disabled: interactionDisabled, velocityDisabled: true }}
        pinch={{ disabled: interactionDisabled }}
        doubleClick={{ disabled: interactionDisabled, mode: "toggle" }}
        onInit={(ref) => {
          const scale = fitView(ref, imageRef?.current);
          fitScaleRef.current = scale;
          onScaleChange(scale);
        }}
        onTransform={(_, state) => onScaleChange(state.scale)}
      >
        {({ zoomIn, zoomOut, state }) => {
          const scale = state.scale;
          const zoomed = scale > fitScaleRef.current + 0.01;
          return (
            <>
              <div className="viewer-toolbar">
                {header}
                <div className="viewer-zoom" role="toolbar" aria-label="Zoom">
                  <button
                    type="button"
                    className="viewer-nav-btn"
                    disabled={interactionDisabled || scale <= fitScaleRef.current + 0.01}
                    onClick={() => zoomOut(0.25, 200)}
                    aria-label="Zoom out"
                  >
                    −
                  </button>
                  <span className="viewer-nav-pos viewer-zoom-pos">
                    {Math.round((scale / fitScaleRef.current) * 100)}%
                  </span>
                  <button
                    type="button"
                    className="viewer-nav-btn"
                    disabled={interactionDisabled || scale >= MAX_SCALE}
                    onClick={() => zoomIn(0.25, 200)}
                    aria-label="Zoom in"
                  >
                    +
                  </button>
                  {zoomed && (
                    <button type="button" className="viewer-zoom-reset" onClick={() => applyFit()}>
                      Fit
                    </button>
                  )}
                </div>
              </div>
              <TransformComponent
                wrapperClass={
                  "viewer-img-wrap" + (tagging ? " tagging" : "") + (zoomed ? " zoomed" : "")
                }
                contentClass="viewer-img-inner"
              >
                <div
                  className="viewer-img-stage"
                  onClick={(e) => {
                    if (e.target === e.currentTarget) onBackgroundClick?.();
                  }}
                >
                  {children}
                </div>
              </TransformComponent>
            </>
          );
        }}
      </TransformWrapper>
    </div>
  );
}

export { fitView as fitViewerImage };
