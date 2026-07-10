/**
 * Robust API helper that routes relative routes correctly.
 */
export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, init);
}

/**
 * Safely parses the JSON response. If the response content-type is not JSON,
 * it returns a helpful error with a snippet of the response text (e.g. from a server 502/503 HTML error page).
 */
export async function safeReadJson(response: Response): Promise<any> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await response.text();
    throw new Error(`Server returned non-JSON response (${response.status}): ${text.substring(0, 150) || "No content"}`);
  }
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Server error (${response.status})`);
  }
  return data;
}
