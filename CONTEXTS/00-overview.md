# 00 — Overview

**What.** A retrieval system over German PDF/DOCX/TXT documents that answers questions with citations and can prove its retrieval quality with a number.

**Who it is for.** (1) An interviewer reading the README in two minutes. (2) The archetype of a small German business with a folder of regulations, contracts and manuals who needs grounded answers and must not leak one tenant's documents to another. The user is a persona, not a customer.

**Data policy.** No real company or personal data anywhere in the repo. The corpus is public federal law (gesetze-im-internet.de) and parliamentary papers; the test fixtures, tenants, ACL principals and golden questions are synthetic. A fictional two-tenant setup (`leak-a`, `leak-b` in the tests) stands in for real customers.

**Success metric.** recall@10 ≥ 0.85 and MRR ≥ 0.6 on a hand-written golden set of 60–100 questions over ~200 documents, hybrid mode, with the eval gate green in CI; p95 retrieval latency and cost per query stated in the README.

**Why this project (hiring).** LLM/RAG was the most-named skill in 28 DACH job descriptions sampled in October 2026 (46%); SQL/Postgres 32%; "has run an eval" is the first thing the hiring managers we found look for. The German-document and permission-aware angles map onto a live AI-engineer ad (Nejo, Cologne) line by line. Full research: the DACH hiring research doc in the LandingPage workspace.

**Document map.**

| File                       | Holds                                                        |
| -------------------------- | ------------------------------------------------------------ |
| `10-architecture.md`       | components, data model, query path, what runs where          |
| `20-eval-and-test-plan.md` | golden-set design, metrics, thresholds, judge alignment plan |
| `30-decisions.md`          | ADR log, one line each, links to `docs/adr/`                 |
| `40-risks.md`              | what could sink it and the fallback for each                 |
| `../TASKS.md`              | the 8-week plan as 1–3 h tasks with acceptance criteria      |
