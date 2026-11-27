# Cloudflare support case draft: Worker CPU-limit termination with low recorded CPU

Status: DRAFT for the owner to submit in the Cloudflare dashboard (Support). Claude has not submitted it and does not
claim the cause is known.

## Summary

A Workers invocation was terminated with the outcome "Worker exceeded CPU time limit or other resource constraints"
(`exceededCpu` in our logs). Recorded CPU time for that invocation was about 280 ms over about 43 s of wall time. The
Worker's configured CPU limit is the default 30 seconds. We need Cloudflare to confirm what constraint terminated the
invocation and whether the recorded CPU figure is the figure the limit applies to.

## Identifiers (no customer data)

- Cloudflare request ID: `6a0ca69881503da9a2838b6383a71921`
- Invocation (our trace prefix): `6a0ca698`
- Request time: 2026-11-26 14:59:21.584 UTC
- Worker: `cyfsa-analyzer-queue-consumer`, deployed version `d030585d` (pre-performance change; no `limits.cpu_ms` set)
- Account: the Pages/Workers account that hosts `cyfsa-navigator-git-staging` (account ID available in the dashboard)
- Usage model: standard

## Telemetry (as recorded by our review; read-only, from the Workers telemetry)

- CPU time reported for the invocation: 280 ms
- Wall time before termination: 43.1 s
- Terminated 4.6 s after the thresholds section completed, while three outbound provider streams were open.
- Other invocations of the same Worker on the same day: 922 ms CPU over 176 s; 1,016 ms CPU over 177 s. Their CPU rate
  (about 6.5 ms per second of wall time) matches the terminated invocation.
- No `exceededMemory` outcome in the last 30 days on any analyzer Worker. This is the only non-`ok` outcome on those
  Workers in that period.

## Retry history (queue delivery of one message)

| Delivery (UTC) | Result |
|---|---|
| 14:51:46 | Section output limit reached; retry budget exhausted; message requeued |
| 14:55:02 | Same |
| 14:58:38 | Terminated (`exceededCpu`) |
| 14:59:51, 15:02:32 | Delivery deferred: the claim lease from the terminated attempt was still held. No second analysis ran. |
| 15:06:33 | Completed 15:09:30 |

One message, one completed analysis, no second reservation. The claim lease (240 s) held the message after termination.

## Questions for Cloudflare

1. Which limit or resource constraint terminated invocation `6a0ca698` / request `6a0ca69881503da9a2838b6383a71921`?
2. Does the 280 ms CPU figure reflect the CPU time counted against the 30-second limit? If not, which figure does?
3. Can subrequest or streaming activity (three open provider streams) trigger this outcome without CPU use?
4. What telemetry should we retain or enable (for example CPU profiles) to diagnose a recurrence?

## Not included

No document text, customer identifiers, credentials, or payment information. Request and timing data only.
