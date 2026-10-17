/**
 * Port to Gemini called from the web service (Moderation, Price List extraction;
 * specs 03 and 05). Only a fake exists in this ticket. Model names come from
 * configuration (spec 00), never hard-coded at call sites.
 */
export interface GeminiStructuredRequest {
  /** Logical task, mapped to a configured model name by the real adapter. */
  task: "moderation" | "priceListExtraction";
  /** Prompt parts; never logged. */
  parts: Array<{ text: string } | { inlineData: { mimeType: string; dataBase64: string } }>;
  /** JSON Schema the output must satisfy. */
  responseSchema: object;
}

export interface GeminiAdapter {
  generateStructured(request: GeminiStructuredRequest): Promise<unknown>;
}
