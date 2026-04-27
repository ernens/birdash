# Security Policy

## Supported Versions

BirdStation is a single-branch project — only the latest released version
on `main` receives security updates. Older versions are not patched
retroactively; please update to the latest version if you need a fix.

| Version  | Supported          |
| -------- | ------------------ |
| Latest   | :white_check_mark: |
| Older    | :x:                |

## Reporting a Vulnerability

**Please do not open a public issue for security vulnerabilities.**

Use GitHub's private security advisory feature instead:
[Report a vulnerability](https://github.com/ernens/birdash/security/advisories/new)

This sends the report directly to the maintainers, kept private until a
fix is released.

### What to include

- A clear description of the vulnerability
- Steps to reproduce (proof of concept if possible)
- The affected component (page, route, library, …)
- Your assessment of impact (data exposure, RCE, DoS, …)
- Suggested mitigation if you have one

### What to expect

- **Acknowledgement**: within 7 days
- **Initial assessment**: within 14 days
- **Fix or mitigation**: within 30 days for high/critical severity, longer
  for low impact issues — coordinated disclosure on a case-by-case basis

If you have not received a response within these windows, you may
escalate by emailing the repository owner via their public GitHub email.

## Scope

In scope:
- The Node.js server (`server/`)
- Frontend Vue pages and bundled scripts (`public/`)
- Inference engine (`engine/`)
- Configuration and update flow

Out of scope:
- Vulnerabilities in third-party dependencies — please report those
  upstream. Dependabot tracks those automatically here.
- Issues requiring physical access to the Pi.
- Social engineering attacks against contributors.

## Recognition

Reporters of valid vulnerabilities are credited in the release notes
of the fix (unless they request anonymity).
