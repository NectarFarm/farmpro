// ── Shared GPS-detect helper (GPS error reporting fix) ──────────────────────
// Both `detectGPS` call sites (components/farm/auth.tsx's RegisterScreen and
// components/farm/admin-onboarding.tsx's LocationEditor) used to do:
//   navigator.geolocation.getCurrentPosition(success, () => setGpsError('Could
//   not get location. Enter manually.'))
// — the error callback ignored its own `GeolocationPositionError` argument,
// so PERMISSION_DENIED, POSITION_UNAVAILABLE, and TIMEOUT all collapsed into
// one message, and no PositionOptions were passed at all (so a slow GPS fix
// could hang with the browser's own multi-minute default timeout).
//
// The single most important distinction this file adds is `isSecureContext`:
// Chrome (and most browsers) refuse geolocation outright on an insecure
// origin — `navigator.geolocation.getCurrentPosition` calls its error
// callback with PERMISSION_DENIED before ever prompting the user. On this
// app's own LAN dev origins (`http://192.168.x.x` — see next.config.ts's
// allowedDevOrigins) that produces exactly this failure, and "permission
// denied" is actively misleading there: there is no permission prompt to
// grant, and no browser setting the user can change to fix it. So this
// helper checks `window.isSecureContext` FIRST and reports that distinctly,
// before ever calling into the geolocation API.
export type GpsCoords = { latitude: string; longitude: string }

// Real, bounded PositionOptions instead of the browser defaults (no options
// previously passed means: low accuracy preferred, no timeout — i.e. it can
// hang indefinitely on a bad fix). `maximumAge` allows reusing a very recent
// cached fix (e.g. the OS already has one from another app) instead of
// forcing a fresh, slower read every time.
const POSITION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 15000,
  maximumAge: 30000,
}

// Turns a real `GeolocationPositionError` into a message that tells the user
// what actually happened and, where possible, what to do about it — instead
// of the one-size-fits-all "Could not get location. Enter manually."
export function describeGeolocationError(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return 'Location permission was denied. Enable location access for this site in your browser settings, then try again — or enter the location manually.'
    case err.POSITION_UNAVAILABLE:
      return 'Your location could not be determined right now (weak GPS/network signal). Try again outdoors or near a window, or enter the location manually.'
    case err.TIMEOUT:
      return 'Location request timed out. Try again, or enter the location manually.'
    default:
      return 'Could not get location. Enter manually.'
  }
}

// Runs the full "detect my GPS location" flow: secure-context check,
// geolocation-support check, then the real browser call with bounded
// options — reporting a specific, actionable message on every failure path.
// Both call sites share this instead of duplicating the logic a third time.
export function detectGpsLocation(
  onSuccess: (coords: GpsCoords) => void,
  onError: (message: string) => void
): void {
  // Checked before touching `navigator.geolocation` at all: on an insecure
  // origin the browser blocks geolocation outright and would otherwise
  // report PERMISSION_DENIED, which is not the real cause and not something
  // the user can fix by changing a permission.
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    onError('Location requires a secure connection (HTTPS). This page was loaded over an insecure connection, so the browser blocks location access here — ask your admin for an HTTPS link, or enter the location manually.')
    return
  }
  if (!navigator.geolocation) {
    onError('Geolocation is not supported on this device or browser.')
    return
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      onSuccess({
        latitude: pos.coords.latitude.toFixed(6),
        longitude: pos.coords.longitude.toFixed(6),
      })
    },
    (err) => onError(describeGeolocationError(err)),
    POSITION_OPTIONS
  )
}
