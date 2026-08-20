# Hermes token analytics plugin agent instructions

## Mandatory installation procedure

Before installing, enabling, validating, repairing, or upgrading this plugin, read and follow the complete checklist:

- [`REQUIRED_INSTALLATION_CHECKLIST.md`](REQUIRED_INSTALLATION_CHECKLIST.md)

A production installation is **not complete** merely because:

- the plugin files were copied;
- the plugin was enabled;
- `doctor` passed; or
- one manual `sync` succeeded.

Unless the user explicitly requests a manual-only/non-production installation, completion requires all of the following:

1. source and installed plugin versions match;
2. the plugin is enabled and the gateway reload is completed or explicitly blocked;
3. `doctor`, `show-config`, and manual `sync` succeed;
4. the cron wrapper exists and is current;
5. exactly one enabled `token-analytics-sync` cron job exists for the intended profile;
6. a cron-triggered run succeeds; and
7. scheduled-path delivery advances dashboard or ingest freshness.

If the gateway cannot restart itself, continue every independent setup and scheduling step that is still possible. Report unchecked checklist items as blockers and describe the result as partial/incomplete—not successfully installed.
