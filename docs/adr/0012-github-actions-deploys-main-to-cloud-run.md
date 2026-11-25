# GitHub Actions deploys `main` to production with keyless, least-privilege access

Until now production was deployed by hand: someone signed in as a project owner and ran `infra/gcp/deploy.sh agent` then `web`. Merges to `main` are manual and `main` has no branch protection, so a deploy that fired on push alone would also ship a red build. We now deploy from the `deploy` job in `.github/workflows/ci.yml`.

- **After CI, behind an approval.** The job `needs` every other CI job and runs only for a push to `main`. It runs in the GitHub `production` environment, so a required reviewer approves each deploy before the job gets any Google Cloud access. Pushes that only change `docs/**` or Markdown skip CI and the deploy.
- **No keys.** The job signs in through Workload Identity Federation. The provider trusts only this repository and `refs/heads/main`, so a pull request, a fork or another branch cannot get a token. There is no service account key to leak or rotate.
- **Least privilege.** The job acts as `fyd-deployer`, which can build, push images, deploy Cloud Run services and jobs, and release Firebase rules, indexes and Hosting. It cannot change IAM, Cloud Scheduler, Workflows or other service accounts, and cannot read Firestore data or Storage objects. `deploy.sh` takes `PROVISION=0` for this: it then skips the service account, IAM binding and Scheduler steps. The default, `PROVISION=1`, is unchanged, so a person with owner rights still runs the script as before to change those.
- **Both services every time.** The agent is redeployed on every deploy, even when its code did not change. A skipped agent deploy after an earlier failed one would leave production on a stale agent, and the cost is one extra image build.
- **Serial, never cancelled.** Deploys share one concurrency group and a newer push waits. Workflow runs on `main` are never cancelled either, because cancelling the run would cancel a deploy halfway.

`infra/gcp/setup-cicd.sh` creates the pool, provider, service account and grants, once, as a project owner.

## Consequences

- A merge to `main` reaches production after one click on the approval. Turning the approval off is removing the required reviewer from the `production` environment.
- Rollback is a Cloud Run traffic switch to the previous revision (`gcloud run services update-traffic fyd-web --region asia-southeast2 --to-revisions=<revision>=100`). Firestore indexes and rules released with the bad commit stay released; fix forward.
- A change to Scheduler jobs, service accounts or IAM in `deploy.sh` does not deploy itself. Run `infra/gcp/deploy.sh` by hand after merging it.
- The `fyd-deployer` roles are broad on Cloud Run (`run.admin`) because deploying services and jobs needs it. Anyone who can merge to `main` and approve the environment can deploy arbitrary code to production, so that is the access to protect.
