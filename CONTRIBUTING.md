# Contributing

## Source control

- **`main` is protected.** Work on branches: `feat/…`, `fix/…`, `chore/…`, `docs/…`.
- **Conventional Commits**: `type(scope): summary` — e.g.
  `feat(api): add load posting endpoint`, `fix(db): index load_events by type`.
  Types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`.
- One logical change per commit. Keep the tree green (`pnpm verify` locally).
- PRs require passing CI (typecheck, lint, unit + integration tests, build) and review.

## Never commit

`.env` or any real secret, credentials, build artifacts, `node_modules`,
database dumps, `*.log`, generated Prisma client, temp files. See `.gitignore`.

## Before pushing

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Schema change? Also:

```bash
pnpm db:migrate            # generates a migration; commit prisma/migrations/**
```

## Code conventions

- Business rules live in `packages/domain` (pure, tested) or an api `*.service.ts`
  — never in a route handler or a React component.
- Shared types come from `@loadtopia/shared`. Don't redefine wire types.
- Money: `Decimal` / `NUMERIC`, decimal strings on the wire. Never `number` for money.
- Timestamps: UTC, `timestamptz`.
- New external dependency? Add it behind a provider interface in `packages/providers`.
- Every status change to a load writes an immutable `load_events` row in the same
  transaction.
