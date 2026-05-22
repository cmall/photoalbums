import type { ReactNode, RefObject } from "react";
import { useEffect } from "react";
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
  onBackgroundClick,
  tagging,
  header,
  children,
}: {
  resetKey: string;
  interactionDisabled: boolean;
  onScaleChange: (scale: number) => void;
  transformRef?: RefObject<ReactZoomPanPinchContentRef | null>;
  onBackgroundClick?: () => void;
  tagging?: boolean;
  /** Album prev/next controls — rendered left of zoom on the top toolbar row. */
  header?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    fitView(transformRef?.current);
  }, [resetKey, transformRef]);

  return (
    <TransformWrapper
      key={resetKey}
      ref={transformRef}
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
      panning={{ disabled: interactionDisabled, velocityDisabled: true }}
      pinch={{ disabled: interactionDisabled }}
      doubleClick={{ disabled: interactionDisabled, mode: "toggle" }}
      onInit={(ref) => {
        fitView(ref);
        onScaleChange(MIN_SCALE);
      }}
      onTransform={(_, state) => onScaleChange(state.scale)}
    >
      {({ zoomIn, zoomOut, resetTransform, state }) => {
        const scale = state.scale;
        const zoomed = scale > MIN_SCALE + 0.01;
        return (
          <>
            <div className="viewer-toolbar">
              {header}
              <div className="viewer-zoom" role="toolbar" aria-label="Zoom">
                <button
                  type="button"
                  className="viewer-nav-btn"
                  disabled={interactionDisabled || scale <= MIN_SCALE}
                  onClick={() => zoomOut(0.25, 200)}
                  aria-label="Zoom out"
                >
                  −
                </button>
                <span className="viewer-nav-pos viewer-zoom-pos">{Math.round(scale * 100)}%</span>
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
                  <button
                    type="button"
                    className="viewer-zoom-reset"
                    onClick={() => resetTransform(200)}
                  >
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
  );
}

export { fitView as fitViewerImage };
