# Hack2skill brief description

Text for the "Brief description" field of the AI Builder Cup 2026 Prototype Submission (issue #109). Every claim is checked against the [README](../../README.md) and [`docs/specs/`](../specs/README.md); keep them in step if the deployed build changes. 188 words, URLs included.

---

FindYourDent helps Indonesian Patients decide what to do about a dental problem and where to go. A Patient describes the problem in their own words and gets Guidance: how urgent it is, the likely category, which kind of Provider to visit, an estimated cost with why prices vary, and BPJS coverage. A deterministic red-flag check runs first and triggers Emergency Escalation to an IGD. A Shortlist then lists nearby Providers with Testimonies from other Patients and price signals.

Firebase Hosting serves findyourdent.com in front of Cloud Run, Firebase Auth signs Patients and Providers in with Google, and App Check with reCAPTCHA Enterprise guards the web API.

Firestore in Jakarta stores Providers, Testimonies, Moderation decisions and owner-confirmed price lists, but never a Patient's complaint text.

Cloud Run in asia-southeast2 runs two services: the public web service, and a private Google ADK agent service that only the web service can call.

Gemini on Vertex AI writes the Guidance card as validated structured output, moderates every Testimony against fixed rules before it is published, and reads a claimed Provider's uploaded price list into rows the owner confirms.

Live: https://findyourdent.com
Code: https://github.com/ahmadwaliradhi/findyourdent
