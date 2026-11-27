# CLAUDE.md

This file provides guidance for AI assistants (Claude and others) working in this repository.

## Repository Overview

This is the `lhopkins78/claude` repository. It is a fresh Git repository currently being initialized with documentation and project structure.

## Git Configuration

- **Remote:** `origin` → `http://local_proxy@127.0.0.1:44083/git/lhopkins78/claude`
- **Default branch:** Main development happens on feature branches prefixed with `claude/`
- **Current feature branch:** `claude/add-claude-documentation-hyjGZ`

## Branch Naming Conventions

Feature branches follow the pattern: `claude/<description>-<session-id>`

- Always develop on the designated feature branch
- Never push directly to `main` or `master` without explicit permission
- Branch names must start with `claude/` to avoid 403 errors on push

## Git Workflow

### Committing

```bash
git add <specific-files>   # Prefer specific files over git add -A
git commit -m "descriptive commit message"
```

- Write clear, descriptive commit messages that explain the "why"
- Never skip hooks (`--no-verify`) unless explicitly asked
- Prefer creating new commits over amending existing ones

### Pushing

```bash
git push -u origin <branch-name>
```

- Always use `-u` flag to set upstream tracking
- If push fails due to network error, retry up to 4 times with exponential backoff (2s, 4s, 8s, 16s)
- Do not push to a different branch without explicit permission

## Development Guidelines

### General Principles

- **Avoid over-engineering:** Only make changes directly requested or clearly necessary
- **Keep solutions simple:** Don't add features, refactor, or "improve" beyond what was asked
- **No unnecessary abstractions:** Three similar lines of code is better than a premature abstraction
- **Trust internal code:** Only validate at system boundaries (user input, external APIs)

### File Operations

- Prefer editing existing files over creating new ones
- Read files before modifying them
- Never create documentation files unless explicitly requested

### Security

- Never introduce command injection, XSS, SQL injection, or other OWASP vulnerabilities
- Do not commit files that contain secrets (`.env`, credentials, API keys)
- Never commit sensitive configuration without explicit instruction

## High-Risk Actions (Require Explicit Confirmation)

Always confirm with the user before:

- Deleting files, branches, or database tables
- Force-pushing or running `git reset --hard`
- Amending published commits
- Pushing to shared branches
- Creating/closing PRs or issues
- Sending messages to external services
- Modifying CI/CD pipelines or shared infrastructure

## Environment

- **Platform:** Linux
- **Shell:** bash/zsh
- **Working directory:** `/home/user/claude`

## Notes for AI Assistants

- `pollinations-studio/` is a dependency-free web app for Pollinations image/video generation: `lib/api.mjs` (API, web Request/Response) runs as a Netlify Function (`netlify/functions/api.mjs`, deployed to Netlify project `pollinations-studio`) or under `server.mjs` locally; UI is `public/index.html`. Its secret key comes from `POLLINATIONS_KEY` (local `.env`, gitignored) and must never be committed
- When the project stack and conventions are established, update this file to reflect them
- Update this file whenever significant new conventions, tooling, or structure is added
- Focus on what is actually present in the codebase, not hypothetical future structure
