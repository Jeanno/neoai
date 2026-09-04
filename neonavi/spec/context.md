# Project context

- CTX-1: Starting at the working directory, every `NAVI.md` on the way up is
  collected, root-first, so a package inside a monorepo gets the repo's context
  before its own.
- CTX-2: The walk stops at the first directory containing `.git`, at the home
  directory, or at the filesystem root, whichever comes first. That directory's
  NAVI.md is included; nothing above it is.
- CTX-3: Each file is prefixed with a `# <absolute path>` heading and the files
  are joined with a blank line.
- CTX-4: The joined text is cut at 8000 characters and marked
  `…[context truncated]`.
- CTX-5: No NAVI.md means no context section in the prompt at all.
