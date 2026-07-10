# Technical Appendix: Confidence-Weighted Prior/Posterior Blending

Status: Draft — candidate technical improvement for patent claim scope. Supersedes the fixed-decay description of "personality-prior weight decays as behavioral data accumulates" in `product-spec-v0.1.md` P0.

## 1. Problem

The cold-start approach uses a deterministic rules engine (trait scores × activity → target audio-feature vector), transitioning to bandit-driven re-ranking as feedback accumulates. Open question: *how fast*, and *by what rule*, should the system reduce reliance on the trait-based prior in favor of observed behavior, per user-activity bucket.

A fixed decay schedule (e.g. "prior weight halves every 10 sessions") is a poor mechanism for two reasons:
- It ignores how much data has actually accumulated for that *specific* bucket — a user with 30 "deep work" sessions and 2 "workout" sessions gets the same curve for both, despite radically different evidence.
- It ignores how *consistent* the behavioral signal is — a bucket with erratic feedback shouldn't override the prior as fast as a bucket with tight, consistent feedback.

## 2. Model

For each (user, activity-bucket) pair and each audio-feature dimension *d* (tempo, energy, valence, acousticness, danceability, …), treat the user's true target value μ_d as unknown, with:

**Prior:** μ_d ~ N(μ0_d, σ0_d²)
- μ0_d = value implied by the trait × activity rules engine (deterministic, set at onboarding).
- σ0_d² = prior uncertainty for that trait-feature pair, set from the strength of the established personality–music-feature correlation (weak literature correlation → wide/uncertain prior; strong correlation → tight prior). Static lookup table, set at design time.

**Observations:** each feedback event *i* in that bucket contributes a pseudo-observation (x_i, w_i):
- x_i = the audio-feature value of the track involved.
- w_i = engagement weight in [-1, 1] derived from feedback type (save/completion → strongly positive; fast skip → strongly negative; natural progression → mild positive), using the existing feedback-reliability ranking (explicit > skip-timing > completion/replay > session-length).

**Posterior** (per dimension, weighted Normal-Normal conjugate update):

Let n = Σ|w_i| (effective sample size), x̄_w = Σ(w_i·x_i)/Σw_i (engagement-weighted mean), σ_obs_d² = running variance of x_i within the bucket (estimated online via Welford's algorithm).

```
μ_post_d = (σ_obs_d² · μ0_d + n · σ0_d² · x̄_w) / (σ_obs_d² + n · σ0_d²)
λ_d       = σ_obs_d² / (σ_obs_d² + n · σ0_d²)      # fraction of blend still attributable to personality
```

Behavior: λ_d → 1 at n = 0 (pure personality prior at cold start). λ_d → 0 as n grows, at a rate that *slows automatically* when σ_obs_d² is large (inconsistent feedback) or σ0_d² is small (high-confidence prior), and *speeds up* when feedback is tight and consistent. This is the "shrinks as a function of variance/sample-size, not a timer" property.

## 3. Algorithm (per bucket, per feature dimension, online update)

```
Initialize: μ0_d, σ0_d² from trait × activity rules
            n = 0; running_mean = μ0_d; running_var_M2 = 0

On each feedback event (track feature x_i, engagement weight w_i):
    n += |w_i|
    delta = x_i - running_mean
    running_mean += (w_i * delta) / n
    running_var_M2 += w_i * delta * (x_i - running_mean)
    sigma_obs_sq = running_var_M2 / max(n - 1, 1)

    mu_post = (sigma_obs_sq * mu0_d + n * sigma0_sq_d * running_mean) / (sigma_obs_sq + n * sigma0_sq_d)
    lambda  = sigma_obs_sq / (sigma_obs_sq + n * sigma0_sq_d)

Use mu_post (not mu0_d) as the bandit's context feature target for this bucket going forward.
```

## 4. Measurable improvement (evaluation plan)

Compare against two baselines: (a) fixed-schedule decay (prior weight halves every *k* sessions, *k* tuned), (b) no prior (cold uniform bandit start). Metrics, per activity bucket:
- **Sessions-to-convergence** — interactions until posterior variance drops below a stability threshold.
- **Early skip-rate** — skip-rate in the first *N* sessions per bucket vs. baselines.
- **Sparse-bucket robustness** — performance in low-session buckets (e.g. "workout") vs. high-session ones (e.g. "deep work"). Claim: this method degrades gracefully in sparse buckets, where fixed-schedule decay does not, because it decays on *evidence*, not on *elapsed sessions/time*.

## 5. Scope note

The underlying math (Normal-Normal conjugate Bayesian updating, precision-weighted blending) is standard statistics — not novel by itself. What's specific to Cadence is the combination: a trait-correlation-derived prior variance, applied per user-activity-bucket, feeding a bandit's context target, replacing a fixed decay schedule, as an integrated solution to the cold-start → warm-start transition. Whether that combination clears novelty/non-obviousness is a question for a patent attorney's prior-art search, not this document.
