# Goal

Ship a credible V1 for the manager mode in bb.

# Completed

| # | Item | What shipped |
|---|------|-------------|
| 1 | Multi-manager support | Dropped `primaryManagerThreadId`, hire always creates, multi-manager UI selector, DB migration |
| 2 | Inter-agent messaging | Deferred — CLI (`bb thread tell`) covers inter-agent communication for V1 |
| 3 | Manager default provider/model | Defaults to `claude-code` + `claude-opus-4-6` with fallback |
| 4 | Hire manager modal | Name input, provider/model picker with defaults, improved layout |
| 5 | Manager @-mention support | Thread suggestion modes (managers/all), type-aware rendering in mention menu |
| 6 | Prompt quality pass | Hero workflows W1–W10, runtime context (project name/id/root, thread id), sub-templates |
| 7 | Environment reuse | Resolved upstream — `bb thread spawn --environment <env-id>` |
| 8 | Thread lifecycle guidance | Archival guidance in prompt and workflows sub-template |
| 9 | Workflows sub-template | Extracted to `bb-manager-workflows.md` with Handlebars partials |
| 10 | CLI command dedup | Removed redundant commands, documented canonical `bb thread` commands |
| 11 | Heading consistency | Normalized to bare text headings throughout manager instructions |
| 12 | Surface language audit | Type-aware copy in delete/rename/archive modals, toasts, action menus |
| 13 | Sidebar collapsed-manager cues | Child count + activity spinner when manager is collapsed |
| 14 | UI handoff actions | Already implemented — manager selector dropdown + unassign button in info tab |
| 15 | @-mention interaction polish | File suggestion dedup, thread type pills, icon removal |
| — | CLI audit | Full audit: `--json` on all commands with enforcement test, `--self` flag, context labels, thread ID safety policy, `bb guide` + `bb status` enrichment, show/status merge, steer merge, work-status/git-diff/merge-base-branches flags, project show/update/delete, `--help` bug fix |
| — | Templates package | Auto-generated types from frontmatter, Handlebars partials, build-time variable validation |
| — | DB migration | `0004_drop_primary_manager_thread_id.sql` |

# Remaining

| # | Item | Notes |
|---|------|-------|
| 16 | Dedicated manager routes eval | Decision item. Defer until the current thread-route approach proves awkward. |
| 17 | Manager QA scenarios | Write QA doc covering hero workflows W1–W11. Run scenarios against current implementation. |

# Related Plans

- `plans/cli-audit.md` — comprehensive CLI audit (all items done, can be deleted)
- `plans/manager-hero-workflows.md` — workflow definitions driving prompt quality
- `plans/templates-package-improvements.md` — templates improvements (all items done, can be deleted)

# Open Questions

- **Notification → turn trigger:** When a managed thread completes, does the system message actually start a new manager turn? Needs verification during QA.
