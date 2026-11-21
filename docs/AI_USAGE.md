# AI Usage

## Planned use cases

- Extract proposed transport-order data from PDF, JPG, and PNG documents.
- Explain optimization outcomes and scenario trade-offs in plain language.
- Produce draft business summaries from already-authorized data.

## Limitations and safeguards

AI output is untrusted input, not a source of operational truth. Extraction may be incomplete, ambiguous, or wrong; generated explanations may be inaccurate. The system must use structured schemas, server-side credentials, input and output validation, auditability, and least-privilege data handling.

## Verification and human approval

Every extracted order must be shown to an authorized user for review and explicit approval before persistence or planning. Solver results require independent deterministic validation against business rules. AI-generated narratives must not override validated solver output, safety constraints, or authorized user decisions.
