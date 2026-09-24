import { bindCanvasElementBitmapSizeTo } from 'fancy-canvas';

// 1. Global error listener: catch any stray unhandled "Object is disposed" errors from lightweight-charts or fancy-canvas
if (typeof window !== 'undefined') {
  const isDisposedError = (msg?: unknown) => {
    if (typeof msg === 'string') {
      return msg.includes('Object is disposed') || msg.includes('is disposed');
    }
    return false;
  };

  window.addEventListener('error', (event) => {
    if (isDisposedError(event.message) || isDisposedError(event.error?.message)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return true;
    }
  }, true);

  window.addEventListener('unhandledrejection', (event) => {
    if (isDisposedError(event.reason?.message) || isDisposedError(event.reason)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
}

// 2. Monkey-patch fancy-canvas DevicePixelContentBoxBinding prototype to eliminate disposal crashes
try {
  if (typeof document !== 'undefined') {
    const dummy = document.createElement('canvas');
    dummy.width = 1;
    dummy.height = 1;

    const binding = bindCanvasElementBitmapSizeTo(dummy, { type: 'device-pixel-content-box' });
    const proto = Object.getPrototypeOf(binding);

    if (proto) {
      // Patch dispose() to be idempotent rather than throwing "Object is disposed"
      const originalDispose = proto.dispose;
      proto.dispose = function() {
        if (this._canvasElement === null) {
          return;
        }
        try {
          return originalDispose.call(this);
        } catch (err: any) {
          if (err?.message?.includes('disposed')) return;
          throw err;
        }
      };

      // Patch resizeCanvasElement() to safely no-op if already disposed
      const originalResize = proto.resizeCanvasElement;
      if (originalResize) {
        proto.resizeCanvasElement = function(clientSize: any) {
          if (this._canvasElement === null) {
            return;
          }
          try {
            return originalResize.call(this, clientSize);
          } catch (err: any) {
            if (err?.message?.includes('disposed')) return;
            throw err;
          }
        };
      }

      // Patch canvasElement getter so that accessing canvasElement after disposal returns a safe detached fallback canvas
      const desc = Object.getOwnPropertyDescriptor(proto, 'canvasElement');
      if (desc && desc.get) {
        const originalGet = desc.get;
        Object.defineProperty(proto, 'canvasElement', {
          get() {
            if (this._canvasElement === null) {
              if (!this._safeFallbackCanvas) {
                this._safeFallbackCanvas = document.createElement('canvas');
                this._safeFallbackCanvas.width = 1;
                this._safeFallbackCanvas.height = 1;
              }
              return this._safeFallbackCanvas;
            }
            try {
              return originalGet.call(this);
            } catch (err: any) {
              if (err?.message?.includes('disposed')) {
                if (!this._safeFallbackCanvas) {
                  this._safeFallbackCanvas = document.createElement('canvas');
                  this._safeFallbackCanvas.width = 1;
                  this._safeFallbackCanvas.height = 1;
                }
                return this._safeFallbackCanvas;
              }
              throw err;
            }
          },
          enumerable: false,
          configurable: true,
        });
      }
    }

    try {
      binding.dispose();
    } catch (_) {}
  }
} catch (err) {
  console.warn('[chartPatch] Could not install prototype safety patch:', err);
}

export {};
