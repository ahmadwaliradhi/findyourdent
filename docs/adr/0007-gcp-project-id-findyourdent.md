# The Google Cloud project ID is `findyourdent`

The first project was created by hand as `findmydent`, a typo. A project ID can never be renamed, and it shows up in the default Firebase domains (`<id>.web.app`, `<id>.firebaseapp.com`, which is also on the Google sign-in screen), the bucket name and every config. So on 17 October 2026, before anything was deployed or spent, we recreated the project as `findyourdent` with `infra/gcp/setup.sh` and deleted `findmydent`. A deleted ID is never reusable, so `findmydent` is gone for good; any reference to it is stale.
