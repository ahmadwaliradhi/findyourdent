# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the "Label in our tracker" column to match whatever vocabulary you actually use.

## When a ticket is human

`lane:human` is the lane label that goes with `ready-for-human` (the other lanes are `lane:A-agent`, `lane:B-web` and `lane:C-platform`; see the build plan, issue 32). Give a ticket these two labels only when its core needs one of these:

- **Identity**: an action Google or another vendor ties to a person, such as a console-only toggle, a terms acceptance, or a payment.
- **Money**: a purchase or a contract.
- **Judgement**: a product, clinical or legal call that the specs leave open.
- **Presence**: recording, presenting, recruiting people, or talking to an outside expert.

If the human part is only a sign-in (`gcloud auth login`, `firebase login`) or supplying values (IDs, emails), the ticket goes to an agent. List the sign-in as the ticket's first step and the values as inputs. List any console-only click as a named manual step, with the exact path. H01 was labelled human but was about 95% scriptable once the owner signed in (see `infra/gcp/setup.sh`).
