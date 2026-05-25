import type { ReactNode, RefObject } from "react";
import { useCallback, useEffect, useState } from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import type { ReactZoomPanPinchContentRef } from "react-zoom-pan-pinch";

const MIN_SCALE = 1;
const MAX_SCALE = 5;

function fitView(ref: ReactZoomPanPinchContentRef | null | undefined) {
  ref?.centerView(MIN_SCALE, 0);
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
  const [zoomScale, setZoomScale] = useState(MIN_SCALE);

  const applyFit = useCallback(() => {
    fitView(transformRef?.current);
    setZoomScale(MIN_SCALE);
    onScaleChange(MIN_SCALE);
  }, [transformRef, onScaleChange]);

  useEffect(() => {
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

  const zoomed = zoomScale > MIN_SCALE + 0.01;

  return (
    <div className="viewer-zoom-stack">
      <div className="viewer-toolbar">
        {header}
        <div className="viewer-zoom" role="toolbar" aria-label="Zoom">
          <button
            type="button"
            className="viewer-nav-btn"
            disabled={interactionDisabled || zoomScale <= MIN_SCALE}
            onClick={() => transformRef?.current?.zoomOut(0.25, 200)}
            aria-label="Zoom out"
          >
            −
          </button>
          <span className="viewer-nav-pos viewer-zoom-pos">{Math.round(zoomScale * 100)}%</span>
          <button
            type="button"
            className="viewer-nav-btn"
            disabled={interactionDisabled || zoomScale >= MAX_SCALE}
            onClick={() => transformRef?.current?.zoomIn(0.25, 200)}
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
      <div className="viewer-img-pane">
        <TransformWrapper
          key={resetKey}
          ref={transformRef}
          disabled={tagging}
          initialScale={1}
          initialPositionX={0}
          initialPositionY={0}
          minScale={MIN_SCALE}
          maxScale={MAX_SCALE}
          centerOnInit
          centerZoomedOut
          limitToBounds
          smooth
          wheel={{ step: 0.12, disabled: interactionDisabled }}
          panning={{
            disabled: interactionDisabled,
            velocityDisabled: true,
            allowLeftClickPan: !interactionDisabled,
          }}
          pinch={{ disabled: interactionDisabled }}
          doubleClick={{ disabled: interactionDisabled, mode: "toggle" }}
          onInit={(ref) => {
            fitView(ref);
            setZoomScale(MIN_SCALE);
            onScaleChange(MIN_SCALE);
          }}
          onTransform={(_, state) => {
            setZoomScale(state.scale);
            onScaleChange(state.scale);
          }}
        >
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
        </TransformWrapper>
      </div>
    </div>
  );
}

export { fitView as fitViewerImage };
