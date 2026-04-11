# Migrations

Idempotent shell scripts that bring an existing install up to a newer
on-disk layout. Run automatically by `scripts/update.sh` after a successful
`git pull`, in lexicographic order.

## Rules each migration must follow

1. **Idempotent.** Running it twice (or on a fresh install) must be a no-op.
   Always probe the current state first and exit cleanly if there's
   nothing to do.

2. **Print one line of intent.** When the migration does something, log
   `[migrate <name>] <what>`. When it's already applied, log
   `[migrate <name>] already applied`. `update.sh` greps these lines for
   the summary.

3. **Back up before destructive edits.** When rewriting a config file,
   write the original to `<file>.before-<migration-name>`.

4. **Never delete user data.** Migrations touch infrastructure / config
   only. Database tables, audio recordings, validations etc. are
   off-limits.

5. **Fail loud, not silent.** If a migration cannot complete safely (e.g.
   the file it expects to find is gone), `exit 1` with a clear message
   and let `update.sh` decide whether to abort the rest.

## Naming

`NNN-short-kebab-name.sh` where `NNN` is a zero-padded sequence number.
The number is for ordering, not chronology — pick the next free one when
adding a migration.

## Adding a new migration

1. Create `scripts/migrations/NNN-foo.sh`
2. `chmod +x` it
3. Test on a real Pi that needs the migration
4. Test on a Pi that's already up to date (should no-op)
5. Commit
