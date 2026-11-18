export const initialScreenshotResource = { status: 'loading', error: '', zoom: 1, offerUpdate: false, objectUrl: '', requestId: 0 };

export function screenshotResourceKey(siteId, preview) {
  return `${siteId}|${preview?.revision || 'missing'}|${preview?.fullUrl || ''}`;
}

export function screenshotResourceReducer(state, action) {
  if (action.type === 'start') return { ...initialScreenshotResource, requestId: action.requestId };
  if (action.type === 'revision') {
    if (state.status === 'error') return { ...initialScreenshotResource, requestId: action.requestId };
    return { ...state, requestId: action.requestId, offerUpdate: state.status === 'ready' };
  }
  if (action.requestId !== state.requestId) return state;
  if (action.type === 'success') return { ...state, status: 'ready', error: '', objectUrl: action.objectUrl, offerUpdate: false };
  if (action.type === 'error') return { ...state, status: 'error', error: action.error, objectUrl: '', offerUpdate: false };
  if (action.type === 'zoom') return { ...state, zoom: Math.max(0.5, Math.min(2, action.zoom)) };
  if (action.type === 'empty') return { ...state, status: 'empty', error: '', objectUrl: '', offerUpdate: false };
  return state;
}
