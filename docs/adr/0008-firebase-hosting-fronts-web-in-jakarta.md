# Firebase Hosting fronts the web service in Jakarta

Spec 00 asked us to check whether Firebase Hosting rewrites can reach a Cloud Run service in `asia-southeast2`, and to fall back to a global external Application Load Balancer (about USD 13.80 for the judging window) or to move the web service to `asia-southeast1` if they cannot. They can: on 17 October 2026 the [Hosting and Cloud Run guide](https://firebase.google.com/docs/hosting/cloud-run) lists `asia-southeast2` among the supported regions. So both services stay in Jakarta, with Firebase Hosting in front of `fyd-web` (`firebase.json` rewrites every path to it) for HTTPS, `findyourdent.web.app` now and the custom domain later, and no load balancer.

Two Hosting and Cloud Run rules shape the code:

- Hosting strips every request cookie except `__session` ([Manage cache behavior](https://firebase.google.com/docs/hosting/manage-cache)). The web service keeps all browser state (the language toggle, the opaque Guidance session id and the Firebase sign-in) in that one cookie, through `apps/web/server/browser-state.ts`. Any new cookie has to go in it too, or it will work locally and break once deployed.
- Cloud Run reserves some URL paths ending in `z` ([known issues](https://docs.cloud.google.com/run/docs/issues)), so the health routes are `/health`, not `/healthz`.

Hosting marks dynamic responses `Cache-Control: private` by default, so server-rendered pages are not cached on the CDN unless a route opts in.
