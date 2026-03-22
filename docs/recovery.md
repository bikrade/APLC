# Recovery

This document covers backup, restore, and recovery procedures for APLC.

## What Needs Protection

- User profiles in blob storage / local `data/`
- User sessions in blob storage / local `data/`
- Insights text files in blob storage / local `data/`
- Container App configuration and Azure resource topology

## Backup Strategy

### Local development

Create a timestamped archive:

```bash
./scripts/backup-local-data.sh
```

### Azure Blob Storage

Export the production blob container with Azure AD auth:

```bash
./scripts/backup-azure-blob.sh aplcfiles2026 userdata backups/blob-export
```

Recommended cadence:

- Before any production data migration
- Before major releases that touch storage logic
- At least daily for production

## Restore Procedure

Restore a blob backup:

```bash
./scripts/restore-azure-blob.sh aplcfiles2026 userdata backups/blob-export
```

Restore a local archive:

```bash
tar -xzf backups/aplc-local-data-<timestamp>.tar.gz
```

## Recovery Drill Checklist

1. Export current production data to a timestamped backup folder.
2. Restore the backup into a non-production storage account or test environment.
3. Run the server test suite.
4. Run E2E tests against the restored environment.
5. Verify a known historical user can load dashboard data and an in-progress session.
6. Record drill date, operator, and any gaps found.

## Incident Response Notes

- If a deploy fails after infrastructure changes, roll back the Container App revision first.
- If application code is healthy but data is corrupt, restore blob data before recycling the app.
- Treat `McapsGovernance` or policy-managed resources as out-of-scope for manual rollback.
