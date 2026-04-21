# Contributing to notion-oncaller

Thank you for your interest in contributing! Here's how to get started.

## Local Development Setup

1. **Fork and clone** the repository:
   ```bash
   git clone https://github.com/<your-username>/notion-oncaller.git
   cd notion-oncaller
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment:**
   ```bash
   cp .env.example .env
   # Fill in your development values
   ```

4. **Run in development mode:**
   ```bash
   npm run dev
   ```

## Branch Naming

Use descriptive branch names with a prefix:

- `feat/add-swap-confirmation` — new features
- `fix/timezone-offset-bug` — bug fixes
- `docs/update-setup-guide` — documentation changes
- `refactor/extract-user-service` — code refactoring
- `test/add-cron-handler-tests` — adding or updating tests
- `chore/update-dependencies` — maintenance tasks

## Pull Request Process

1. **Create a feature branch** from `main`
2. **Make your changes** with clear, focused commits
3. **Ensure all checks pass:**
   ```bash
   npm run build
   npm test
   npm run lint
   ```
4. **Open a pull request** against `main`
5. **Fill out the PR template** — describe what changed and how to test it
6. **Wait for review** — a maintainer will review your PR

## Code Style

- **TypeScript** with strict mode enabled
- **Formatting** — follow the project's `.prettierrc` configuration
- **Linting** — run `npm run lint` and fix any issues before committing
- **Tests** — use [Jest](https://jestjs.io/) for all tests
  - Place test files in `__tests__/` directories next to the code they test
  - Name test files `<module>.test.ts`
  - Aim for meaningful coverage, not 100% line coverage

## Commit Message Format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <description>

[optional body]
```

### Types

| Type | Purpose |
|------|---------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test` | Adding or updating tests |
| `chore` | Maintenance (deps, CI, build, etc.) |

### Examples

```
feat(slack): add shift swap confirmation modal
fix(cron): correct timezone offset in reminder calculation
docs: update deployment instructions
test(notion): add integration tests for schedule queries
chore: upgrade TypeScript to v6
```

## Reporting Issues

- Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md) for bugs
- Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md) for ideas
- Search existing issues before creating a new one

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold this code.
