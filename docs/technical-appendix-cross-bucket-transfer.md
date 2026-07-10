# Technical Appendix: Cross-Bucket Transfer via Trait-Mediated Similarity

Status: Draft — candidate technical improvement, companion to the Bayesian blending appendix. Addresses within-user data sparsity across activity buckets.

## 1. Problem

Cadence learns a separate preference profile per user-activity bucket (deep work, calls, creative, commute, workout, wind-down). Buckets accumulate feedback at very different rates: a user may have 40 "deep work" sessions and 2 "workout" sessions. Sparse buckets stay stuck at the cold-start prior long after data-rich buckets have converged, so the sparse-bucket experience lags.

Standard cross-domain recommendation fixes sparsity by transferring knowledge *across users* or *across product domains*. That prior art is well-trodden. The narrower, less-populated problem here is **within a single user, across their own activity contexts** — and the specific question of *how much* a rich bucket should inform a sparse one.

## 2. Mechanism

Each activity bucket carries a **context trait vector** — the user's OCEAN vector adjusted by an activity-specific modifier (e.g. "workout" shifts toward higher target energy regardless of person; "wind-down" shifts lower). Two buckets that call for similar audio characteristics have similar context vectors.

When a target bucket is data-sparse, borrow the learned posterior of data-rich buckets *for the same user*, weighted by the trait-vector similarity between source and target context.

Let:
- `c_t` = context trait vector of the target (sparse) bucket
- `c_s` = context trait vector of a source (rich) bucket
- `sim(c_s, c_t)` = cosine similarity in [0, 1]
- `μ_s` = converged posterior feature target of source bucket s
- `n_s` = effective sample size (evidence) in source bucket s

**Transfer-augmented prior** for the target bucket, per feature dimension:

```
weight_s = sim(c_s, c_t) * confidence(n_s)          # similar AND well-evidenced sources count more
μ_transfer = Σ_s (weight_s * μ_s) / Σ_s weight_s     # over all other buckets s ≠ t
```

`confidence(n_s)` rises with evidence and saturates (e.g. `n_s / (n_s + k)`), so a rich, similar bucket dominates the borrow while a sparse or dissimilar one contributes little.

## 3. Integration with the Bayesian prior

The transferred estimate replaces (or blends into) the cold-start prior `μ0` used by the Bayesian blending appendix, **only to the extent the target bucket lacks its own evidence:**

```
μ0_effective = (1 - α) * μ0_personality  +  α * μ_transfer
```
where `α` scales with how much transferable evidence exists relative to the target's own. As the target bucket accumulates its own feedback, the Bayesian posterior update naturally shrinks the influence of *both* the personality prior and the transferred term — the two priors fade together on evidence.

This coupling is the specific, integrated mechanism: **trait-mediated, within-user, cross-bucket transfer feeding a variance-controlled Bayesian prior.**

## 4. Why the narrowing matters (novelty positioning)

- The *concept* — borrow from a data-rich context to help a sparse one, weighted by similarity — is textbook transfer learning and **not novel**.
- What is specific: the **similarity function is a personality-trait vector**, not overlapping users, item embeddings, or interaction patterns; the transfer is **within a single user across activity contexts**; and it **feeds a Bayesian prior variance** rather than a point estimate.
- That combination is narrow and concrete — the shape that survives patent examination *if* a claims-level prior-art search confirms the trait-as-transfer-weight step is unclaimed. It is also, being narrow, easy for a competitor to design around (a different similarity metric sidesteps it). Both facts are for a patent attorney to weigh, not this document.

## 5. Evaluation plan

- **Sparse-bucket lift** — early skip-rate in low-session buckets, with vs. without transfer. Expect the largest gains where the target bucket is sparse but a similar rich bucket exists.
- **No-harm check** — confirm transfer does not degrade buckets that are dissimilar to all others (the similarity weight should suppress bad borrows automatically).
- **Convergence** — sessions-to-stability for sparse buckets vs. the Bayesian-only baseline.

## 6. Dependency note

This mechanism is agnostic to the music-data source (Deezer / Apple Music / etc.) — it operates on learned feature targets, not raw catalog calls. See `music-data-layer.md`.
