
import { GoogleGenAI } from "@google/genai";
import { RubricItem, STARResult, AppSettings } from "../types";

const SYSTEM_INSTRUCTION = `You are a skeptical, high-standards HR Auditor. 
Objective: Scrutinize candidate responses for concrete behavioral evidence (STAR: Situation, Task, Action, Result).

RULES:
1. **ZERO TOLERANCE FOR HALLUCINATION**: Only usage facts explicitly present in the audio or transcript. If audio is silent or unclear, state "[unintelligible]". Do NOT invent details to fill gaps.
2. DO NOT accept vague generalities. Mark missing STAR fields as "" if evidence is not explicit.
3. ACCUMULATE evidence: Merge new details with previous context. 
4. BE CRITICAL: If a candidate pivots, note it.
5. PROBE SHARPLY: Generate 2-3 specific questions to expose gaps.
6. Return valid JSON only.`;

/**
 * Attempts to repair common JSON truncation issues like missing closing quotes or braces.
 */
const repairJson = (jsonString: string): string => {
  let repaired = jsonString.trim();
  if (!repaired) return "{}";

  // If the string doesn't start with '{', find the first one
  const firstBrace = repaired.indexOf('{');
  if (firstBrace !== -1) {
    repaired = repaired.substring(firstBrace);
  }

  // Handle unterminated quotes
  let inString = false;
  for (let i = 0; i < repaired.length; i++) {
    if (repaired[i] === '"' && repaired[i - 1] !== '\\') {
      inString = !inString;
    }
  }

  // If we are still "in a string" at the end, close the quote
  if (inString) {
    repaired += '"';
  }

  // Handle missing closing braces
  let openBraces = 0;
  for (let i = 0; i < repaired.length; i++) {
    // Only count braces NOT inside strings
    let isInsideString = false;
    let qCount = 0;
    for (let j = 0; j < i; j++) if (repaired[j] === '"' && repaired[j - 1] !== '\\') qCount++;
    isInsideString = qCount % 2 !== 0;

    if (!isInsideString) {
      if (repaired[i] === '{') openBraces++;
      if (repaired[i] === '}') openBraces--;
    }
  }

  while (openBraces > 0) {
    repaired += '}';
    openBraces--;
  }

  return repaired;
};

/**
 * Helper to safely extract and parse JSON from the model's response.
 */
const parseCleanJson = (text: string) => {
  if (!text) return {};

  try {
    // 1. Direct parse
    return JSON.parse(text);
  } catch (initialError) {
    try {
      // 2. Extract substring between first { and last }
      const firstBrace = text.indexOf('{');
      const lastBrace = text.lastIndexOf('}');

      if (firstBrace !== -1 && lastBrace !== -1) {
        const jsonCandidate = text.substring(firstBrace, lastBrace + 1);
        return JSON.parse(jsonCandidate);
      }

      // 3. Last resort: Attempt to repair a truncated JSON
      const repaired = repairJson(text);
      return JSON.parse(repaired);
    } catch (secondaryError) {
      console.error("JSON Parsing failed completely. Length:", text.length, "Text:", text);
      throw new Error("The AI response was malformed or severely truncated. Please keep your response a bit shorter.");
    }
  }
};

/**
 * Helper to limit the transcript context sent to the model.
 */
const getRecentTranscript = (transcript: string, maxLength = 1500) => {
  if (transcript.length <= maxLength) return transcript;
  return "[...] " + transcript.slice(-maxLength);
};

/**
 * Helper to get the API key for Google
 */
const getGoogleApiKey = (settings: AppSettings): string => {
  const key = settings.googleApiKey || (import.meta as any).env?.VITE_GEMINI_API_KEY || (import.meta as any).env?.GEMINI_API_KEY;
  if (!key || key === 'PLACEHOLDER_API_KEY') {
    throw new Error("Google API Key is missing. Please provide it in Settings.");
  }
  return key;
};

/**
 * Creates a GoogleGenAI client from settings.
 */
const createGoogleClient = (settings: AppSettings): GoogleGenAI => {
  const apiKey = getGoogleApiKey(settings);
  return new GoogleGenAI({ apiKey });
};

// --- OpenRouter Logic ---

const callOpenRouter = async (
  settings: AppSettings,
  messages: any[],
  schemaDescription?: string
) => {
  if (!settings.openRouterApiKey) throw new Error("OpenRouter API Key is missing.");

  const fullMessages = [
    { role: "system", content: SYSTEM_INSTRUCTION + (schemaDescription ? `\n\nEnsure JSON matches this structure: ${schemaDescription}` : "") },
    ...messages
  ];

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${settings.openRouterApiKey}`,
      "HTTP-Referer": window.location.origin,
      "X-Title": "Local BARS Interviewer",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: settings.modelName,
      messages: fullMessages,
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("OpenRouter Error Body:", errText);
    throw new Error(`OpenRouter Error (${response.status}): ${errText.substring(0, 200)}...`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter returned empty content.");

  return content;
};

/**
 * Helper to ensure a value is a string, preventing [object Object] in UI.
 */
const ensureString = (val: any): string => {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object') {
    // Try common keys if the model nested it, or stringify
    return val.text || val.content || val.transcript || val.response || JSON.stringify(val);
  }
  return String(val || "");
};

// --- Main Service Functions ---

export const analyzeAndProbe = async (
  settings: AppSettings,
  audioBase64: string,
  mimeType: string,
  rubricItem: RubricItem,
  currentTranscript: string,
  previousSTAR?: STARResult
): Promise<{
  newTranscriptSnippet: string;
  starUpdate: STARResult;
  probingQuestions: string[];
}> => {
  // Step 1: Transcribe the audio completely
  const newTranscriptSnippet = await transcribeAudio(settings, audioBase64, mimeType);

  // Step 2: Analyze the transcript for STAR evidence and generate probing questions
  const { starUpdate, probingQuestions } = await analyzeTranscript(
    settings,
    newTranscriptSnippet,
    rubricItem,
    currentTranscript,
    previousSTAR,
    true // Generate probing questions
  );

  return {
    newTranscriptSnippet,
    starUpdate,
    probingQuestions
  };
};

export const transcribeAudio = async (
  settings: AppSettings,
  audioBase64: string,
  mimeType: string
): Promise<string> => {
  const prompt = "Transcribe audio verbatim. Provide the complete transcript of everything spoken.";

  if (settings.provider === 'openrouter') {
    // OpenRouter generic API
    // We attempt to send the audio as a multimodal input (image_url hack or proper input if supported)
    try {
      const prompt = "Transcribe this audio verbatim. Output only the text.";
      const rawText = await callOpenRouter(settings, [{
        role: "user",
        content: [
          {
            type: "image_url", // Many OpenRouter models use this for multimodal inputs (images/audio)
            image_url: { url: `data:${mimeType};base64,${audioBase64}` }
          },
          { type: "text", text: prompt }
        ]
      }]);
      return rawText.trim();
    } catch (err: any) {
      console.warn("OpenRouter Transcription failed:", err);
      throw new Error(`OpenRouter Transcription failed. Ensure your selected model (${settings.modelName}) supports audio input. Error: ` + err.message);
    }
  }

  // Sarvam Provider
  if (settings.provider === 'sarvam') {
    if (!settings.sarvamApiKey) throw new Error("Sarvam API Key is missing.");

    const formData = new FormData();
    // Convert base64 back to blob for FormData
    const byteCharacters = atob(audioBase64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: mimeType });

    formData.append('file', blob, 'audio.wav');
    formData.append('model', 'saaras:v3');

    const response = await fetch('https://api.sarvam.ai/speech-to-text', {
      method: 'POST',
      headers: { 'api-subscription-key': settings.sarvamApiKey },
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Sarvam Transcription Failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    return data.transcript || "";
  }

  // Google Provider — using new @google/genai SDK
  const ai = createGoogleClient(settings);

  try {
    const response = await ai.models.generateContent({
      model: settings.modelName,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data: audioBase64 } },
            { text: prompt }
          ]
        }
      ],
      config: {
        systemInstruction: "You are a professional transcriber. Output only the verbatim transcript text. Do NOT use JSON."
      }
    });
    return response.text?.trim() || "";
  } catch (err: any) {
    console.error("Gemini transcription error:", err);
    throw err;
  }
};

/**
 * Analyzes a transcript (text-only) for STAR evidence.
 * Optionally generates probing questions.
 */
export const analyzeTranscript = async (
  settings: AppSettings,
  newTranscriptSnippet: string,
  rubricItem: RubricItem,
  currentTranscript: string,
  previousSTAR?: STARResult,
  generateProbes: boolean = true
): Promise<{
  starUpdate: STARResult;
  probingQuestions: string[];
}> => {
  const recentTranscript = getRecentTranscript(currentTranscript);
  const previousSTARContext = previousSTAR ? JSON.stringify(previousSTAR) : "None (New)";

  const promptText = `
    Question: "${rubricItem.question}"
    Previous STAR Context: ${previousSTARContext}
    Recent Transcript Context: "${recentTranscript}"
    New Transcript Snippet: "${newTranscriptSnippet}"
    
    TASK: 
    1. ACCUMULATE STAR evidence for "${rubricItem.parameter}". MERGE new facts with Previous STAR Context. Do not lose old details unless contradicted.
    ${generateProbes ? '2. Generate 2-3 SHARP, specific probing questions if STAR is incomplete or vague.' : '2. Do NOT generate probing questions (the interview for this parameter is complete).'}
    
    RESTRICTIONS:
    - Evidence must be explicit.
    - Output MUST be valid JSON.
  `;

  if (settings.provider === 'openrouter') {
    const rawJson = await callOpenRouter(settings, [{
      role: "user",
      content: [{ type: "text", text: promptText }]
    }], "Return JSON with: starUpdate (object with situation, task, action, result), probingQuestions (array of strings).");

    const parsed = parseCleanJson(rawJson);
    return {
      starUpdate: parsed.starUpdate || { situation: '', task: '', action: '', result: '' },
      probingQuestions: parsed.probingQuestions || []
    };
  }

  // Sarvam Provider - Analysis Not Supported directly via this service yet
  if (settings.provider === 'sarvam') {
    throw new Error("Sarvam AI currently supports transcription only. Please select Google or OpenRouter for analysis capabilities.");
  }

  // Google Provider — using new @google/genai SDK
  const ai = createGoogleClient(settings);

  try {
    const response = await ai.models.generateContent({
      model: settings.modelName,
      contents: promptText,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            starUpdate: {
              type: "object",
              properties: {
                situation: { type: "string" },
                task: { type: "string" },
                action: { type: "string" },
                result: { type: "string" },
              },
              required: ["situation", "task", "action", "result"]
            },
            probingQuestions: {
              type: "array",
              items: { type: "string" }
            }
          },
          required: ["starUpdate", "probingQuestions"]
        }
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("AI returned an empty response.");
    }

    const parsed = parseCleanJson(text);
    return {
      starUpdate: parsed.starUpdate || { situation: '', task: '', action: '', result: '' },
      probingQuestions: parsed.probingQuestions || []
    };
  } catch (err: any) {
    console.error("Gemini analyzeTranscript Error:", err);
    throw err;
  }
}

export const analyzeHolisticSTAR = async (
  settings: AppSettings,
  fullTranscript: string,
  rubric: RubricItem[]
): Promise<Record<string, { starEvidence: STARResult; rating: number }>> => {
  const truncatedFullTranscript = getRecentTranscript(fullTranscript, 12000); // Increased context window

  const promptText = `
    You are an expert HR Auditor.
    Objective: Review the ENTIRE interview transcript to extract holistic STAR evidence for specific competencies.
    
    CRITICAL INSTRUCTION: 
    Candidates often scatter evidence across different questions. 
    You must CROSS-REFERENCE the entire transcript. 
    If a candidate mentions a "Conflict Resolution" example while answering a "Leadership" question, YOU MUST capture it for the "Conflict Resolution" parameter.

    PARAMETERS TO ANALYZE:
    ${rubric.map(r => `
    --- ID: ${r.id} ---
    Parameter: ${r.parameter}
    Question Asked: "${r.question}"
    Rubric Anchors:
      1 (Poor): ${r.level1}
      2 (Fair): ${r.level2}
      3 (Good): ${r.level3}
      4 (Excellent): ${r.level4}
    `).join('\n')}

    FULL TRANSCRIPT:
    ---
    ${truncatedFullTranscript}
    ---
    
    OUTPUT FORMAT:
    Return a JSON map where keys are the Parameter IDs.
    Values must be objects with:
    - starEvidence: { situation, task, action, result }
    - rating: (1-4 integer based on anchors)
    
    RULES:
    1. READ BETWEEN THE LINES. Look for consistency and depth.
    2. If evidence is vague or generic, rate lower (1 or 2).
    3. If evidence is concrete and specific (names, numbers, quotes), rate higher (3 or 4).
    4. "starEvidence" fields must be strings.
  `;

  if (settings.provider === 'openrouter') {
    const rawJson = await callOpenRouter(settings, [{
      role: "user",
      content: [{ type: "text", text: promptText }]
    }], "Return JSON map: keys=IDs, values={ starEvidence: {situation, task, action, result}, rating: number }");
    return parseCleanJson(rawJson);
  }

  // Sarvam Provider - Analysis Not Supported directly via this service yet
  if (settings.provider === 'sarvam') {
    throw new Error("Sarvam AI currently supports transcription only. Please select Google or OpenRouter for holistic analysis.");
  }

  // Google Provider — using new @google/genai SDK
  const ai = createGoogleClient(settings);

  // Build schema dynamically
  const properties: any = {};
  rubric.forEach(item => {
    properties[item.id] = {
      type: "object",
      properties: {
        starEvidence: {
          type: "object",
          properties: {
            situation: { type: "string" },
            task: { type: "string" },
            action: { type: "string" },
            result: { type: "string" },
          },
          required: ["situation", "task", "action", "result"]
        },
        rating: { type: "number", description: "1 to 4 integer" }
      },
      required: ["starEvidence", "rating"]
    };
  });

  try {
    const response = await ai.models.generateContent({
      model: settings.modelName,
      contents: promptText,
      config: {
        systemInstruction: "Extract holistic STAR evidence and assign ratings (1-4). Return JSON map.",
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: properties,
          required: rubric.map(r => r.id)
        }
      }
    });

    return parseCleanJson(response.text || '{}');
  } catch (err: any) {
    console.error("Gemini holistic analysis error:", err);
    throw err;
  }
};

export const generateMasterTranscript = async (
  settings: AppSettings,
  audioBlobs: { blob: Blob; mimeType: string }[]
): Promise<string> => {
  const prompt = "Please transcribe the following interview audio files verbatim. Combine them into a single chronological transcript. Label speakers as INTERVIEWER and CANDIDATE if possible, or just transcribe the dialogue directly.";

  // Helper to convert blob to base64
  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  // Convert each blob individually to base64 and create a part for the API
  const audioParts = await Promise.all(audioBlobs.map(async (item) => ({
    inlineData: {
      data: await blobToBase64(item.blob),
      mimeType: item.mimeType
    }
  })));

  if (settings.provider === 'openrouter') {
    // Attempt OpenRouter Master Transcript
    // Note: OpenRouter models vary in multi-modal support.
    try {
      const rawText = await callOpenRouter(settings, [{
        role: "user",
        content: [
          ...audioParts.map(p => ({
            type: "image_url",
            image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` }
          })),
          { type: "text", text: prompt }
        ]
      }]);
      return rawText;
    } catch (err: any) {
      console.warn("OpenRouter Master Transcript failed:", err);
      return "Master Transcript generation failed with OpenRouter. Ensure the selected model supports multi-modal input (audio/video). Error: " + err.message;
    }
  }

  // Google Provider — using new @google/genai SDK
  const ai = createGoogleClient(settings);

  try {
    const response = await ai.models.generateContent({
      model: settings.modelName,
      contents: [
        {
          role: "user",
          parts: [
            ...audioParts,
            { text: prompt }
          ]
        }
      ],
      config: {
        systemInstruction: "You are a professional transcriber. Output only the verbatim transcript.",
        temperature: 0.2
      }
    });
    return response.text?.trim() || "No transcript generated.";
  } catch (err: any) {
    console.error("Master transcript error:", err);
    throw new Error(`Failed to generate master transcript: ${err.message}`);
  }
};

/**
 * Regenerates analysis for a single question using ALL accumulated audio.
 * This is effectively a "Retry" or "Re-run" button feature.
 */
export const regenerateQuestionAnalysis = async (
  settings: AppSettings,
  audioBlobs: { blob: Blob; mimeType: string }[],
  rubricItem: RubricItem
): Promise<{
  transcript: string;
  starUpdate: STARResult;
  probingQuestions: string[];
}> => {
  // 1. Prepare all audio parts
  const blobToBase64 = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  const audioParts = await Promise.all(audioBlobs.map(async (item) => ({
    inlineData: {
      data: await blobToBase64(item.blob),
      mimeType: item.mimeType
    }
  })));

  const promptText = `
    This interview response is split across ${audioBlobs.length} separate audio files.
    They are provided in chronological order.
    
    YOUR TASK:
    1. Listen to ALL audio files in the sequence. Each part contains a separate section of the conversation.
    2. Transcribe the FULL conversation from start to finish, merging all parts into a single coherent transcript.
    3. Extract the FINAL consolidated STAR evidence for "${rubricItem.parameter}".
    4. Generate 2-3 specific probing questions IF the evidence is still weak.
    
    Output Format: JSON.
    `;

  if (settings.provider === 'openrouter') {
    const rawJson = await callOpenRouter(settings, [{
      role: "user",
      content: [
        ...audioParts.map(p => ({
          type: "image_url",
          image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` }
        })),
        { type: "text", text: promptText }
      ]
    }], "Return JSON with: transcript (string), starUpdate (object), probingQuestions (array).");

    const parsed = parseCleanJson(rawJson);
    return {
      ...parsed,
      transcript: ensureString(parsed.transcript)
    };
  }

  // Google Provider — using new @google/genai SDK
  const ai = createGoogleClient(settings);

  try {
    const response = await ai.models.generateContent({
      model: settings.modelName,
      contents: [
        {
          role: "user",
          parts: [
            ...audioParts,
            { text: promptText }
          ]
        }
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            transcript: { type: "string" },
            starUpdate: {
              type: "object",
              properties: {
                situation: { type: "string" },
                task: { type: "string" },
                action: { type: "string" },
                result: { type: "string" },
              },
              required: ["situation", "task", "action", "result"]
            },
            probingQuestions: {
              type: "array",
              items: { type: "string" }
            }
          },
          required: ["transcript", "starUpdate", "probingQuestions"]
        }
      }
    });

    const text = response.text;
    const parsed = parseCleanJson(text || '');
    return {
      ...parsed,
      transcript: ensureString(parsed.transcript)
    };
  } catch (err: any) {
    console.error("Regenerate Analysis Error:", err);
    throw err;
  }
};
