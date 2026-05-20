# Squad Issues Router

Public-safe Squadboard App for the scheduled-intake operating model and triage of Squad GitHub Issues from `https://github.com/bradygaster/squad`.

## Board

The app keeps the board intentionally small:

| Column | Purpose |
|---|---|
| Triage | New or changed GitHub issues land here for classification. |
| Needs Info | Issues that need contributor clarification or missing diagnostics. |
| Done | Closed, duplicate, or no-action issues after triage. |

## Scheduled intake contract

`Squad GitHub Issue Intake` declares an every-6-hours cadence (`0 */6 * * *`) with the intended `squadboard.github-issue-intake.v1` contract:

- Source repo: `bradygaster/squad`
- Fetch only open issues updated since `project.githubSyncLastAt`
- Dedupe/upsert by `githubIssueNumber` and `githubNodeId`
- Exclude pull requests from issue intake
- Route new or changed issues into `Triage`
- Hand the batch to the `Squad Issue Triage` ceremony for classification, duplicate checks, good-first-issue suitability, and maintainer escalation notes

Backend dependency: the reusable scheduled GitHub issue intake primitive is not implemented in the ceremony runner yet, and the current app installer does not turn this contract into durable importer state. The bundle declares the contract in `project.settings.githubIssueIntake`, the scheduled trigger config, and the workflow YAML so Hockney can wire it to `GitHubSync.pullChanges(since)` without changing the app package.
