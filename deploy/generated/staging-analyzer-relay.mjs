// functions/api/_analyzer-queue-contract.ts
var JOB_ID = /^[A-Za-z0-9_-]{8,128}$/;
function createAnalyzerQueueMessage(jobId) {
  if (!JOB_ID.test(jobId)) {
    throw new Error("Invalid analyzer job identifier");
  }
  return { version: 1, jobId };
}
function parseAnalyzerQueueMessage(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid analyzer queue payload");
  }
  const record = value;
  if (Object.keys(record).length !== 2 || record.version !== 1 || typeof record.jobId !== "string") {
    throw new Error("Invalid analyzer queue payload");
  }
  return createAnalyzerQueueMessage(record.jobId);
}

// workers/staging-queue-relay.ts
var staging_queue_relay_default = {
  fetch() {
    return new Response("Not found", { status: 404 });
  },
  async queue(batch, env) {
    if (!["cyfsa-staging-analyzer-jobs", "cyfsa-staging-analyzer-dead-letter"].includes(batch.queue)) throw new Error("Unexpected staging queue");
    if (!env.ANALYZER_EXECUTOR) throw new Error("Private analyzer service binding missing");
    for (const message of batch.messages) {
      let body;
      try {
        body = parseAnalyzerQueueMessage(message.body);
      } catch {
        message.ack();
        continue;
      }
      try {
        const result = await env.ANALYZER_EXECUTOR.processJob(body, message.attempts, batch.queue === "cyfsa-staging-analyzer-jobs" ? "primary" : "dead-letter");
        if (result.action === "ack") message.ack();
        else if (result.action === "retry" && Number.isFinite(result.delaySeconds) && result.delaySeconds >= 0 && result.delaySeconds <= 900) message.retry({ delaySeconds: result.delaySeconds });
        else throw new Error("Invalid private analyzer disposition");
      } catch {
        console.error("[STAGING_ANALYZER_RPC_RETRY]");
        message.retry({ delaySeconds: 30 });
      }
    }
  }
};
export {
  staging_queue_relay_default as default
};
