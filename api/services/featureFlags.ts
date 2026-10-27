/**
 * Server-controlled feature flags. Every flag defaults OFF in every environment.
 *
 * A flag is on only when its environment variable is exactly "true". Absence, "1", "TRUE", or any other value is off.
 * Flags are read at request time, so turning one on or off needs no code change. Turning a flag on in production is
 * a production activation and needs the owner's explicit approval.
 */
export const ACROFORM_FIELD_INGESTION_FLAG = "ACROFORM_FIELD_INGESTION";

export function acroFormFieldIngestionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[ACROFORM_FIELD_INGESTION_FLAG] === "true";
}
