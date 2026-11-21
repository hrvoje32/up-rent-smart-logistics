# Engineering Guide

## Code standards

- Write small, readable modules with a single clear responsibility.
- Use strict TypeScript and explicit Python types at public boundaries.
- Prefer simple, direct implementations; do not introduce abstractions without a present use.
- Keep feature, UI, domain, and infrastructure concerns separate.
- Use consistent names: `PascalCase` for React components and Python classes, `camelCase` for TypeScript values, and `snake_case` for Python values.

## Safety and correctness

- Validate untrusted input at system boundaries with schemas.
- Use secure defaults, clear failures, and actionable error messages.
- Never commit credentials, connection strings, tokens, or private customer data.
- Never bypass authorization or weaken security checks for convenience.
- Do not use `any` in TypeScript without a documented, narrow justification.

## Quality and documentation

- Add focused tests for business logic as it is introduced; do not fake coverage for unbuilt features.
- Keep public interfaces and architecture decisions documented.
- Update relevant documentation when behavior, configuration, or operational commands change.
- Run the applicable type, lint, test, and build checks before handing work off.
