
export interface LiveTranscriptionCallbacks {
    onTranscript: (text: string, isFinal: boolean) => void;
    onError: (error: Error) => void;
    onStatusChange: (status: 'connecting' | 'connected' | 'disconnected') => void;
}

// Simplified interface, main definition moved above
/* 
 interface LiveSession defined above in file scope for closure access
*/

const SAMPLE_RATE = 16000;
const CHUNK_DURATION_MS = 3000; // 3 seconds per chunk

interface LiveSession {
    audioContext: AudioContext | null;
    mediaStream: MediaStream | null;
    scriptNode: ScriptProcessorNode | null;
    sourceNode: MediaStreamAudioSourceNode | null;
    isActive: boolean;
    accumulatedData: Float32Array[]; // Current chunk buffer
    totalSamples: number;
    intervalId: NodeJS.Timeout | null;
    // Full session storage
    fullAudioChunks: Float32Array[];
    fullTranscript: string;
}

let currentSession: LiveSession | null = null;

// --- Helper Functions ---

function resample(audioBuffer: Float32Array, fromSampleRate: number, toSampleRate: number): Float32Array {
    if (fromSampleRate === toSampleRate) {
        return audioBuffer;
    }
    const ratio = fromSampleRate / toSampleRate;
    const newLength = Math.round(audioBuffer.length / ratio);
    const result = new Float32Array(newLength);

    // Linear Interpolation for better quality than nearest-neighbor
    for (let i = 0; i < newLength; i++) {
        const originalIndex = i * ratio;
        const index1 = Math.floor(originalIndex);
        const index2 = Math.min(index1 + 1, audioBuffer.length - 1);
        const fraction = originalIndex - index1;

        const val1 = audioBuffer[index1];
        const val2 = audioBuffer[index2];

        result[i] = val1 + (val2 - val1) * fraction;
    }
    return result;
}

function floatTo16BitPCM(output: DataView, offset: number, input: Float32Array) {
    for (let i = 0; i < input.length; i++, offset += 2) {
        const s = Math.max(-1, Math.min(1, input[i]));
        // 16-bit PCM scale
        output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
}

function encodeWAV(samples: Float32Array): Blob {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    /* RIFF identifier */
    writeString(view, 0, 'RIFF');
    /* RIFF chunk length */
    view.setUint32(4, 36 + samples.length * 2, true);
    /* RIFF type */
    writeString(view, 8, 'WAVE');
    /* format chunk identifier */
    writeString(view, 12, 'fmt ');
    /* format chunk length */
    view.setUint32(16, 16, true);
    /* sample format (raw) */
    view.setUint16(20, 1, true);
    /* channel count */
    view.setUint16(22, 1, true);
    /* sample rate */
    view.setUint32(24, SAMPLE_RATE, true);
    /* byte rate (sample rate * block align) */
    view.setUint32(28, SAMPLE_RATE * 2, true);
    /* block align (channel count * bytes per sample) */
    view.setUint16(32, 2, true);
    /* bits per sample */
    view.setUint16(34, 16, true);
    /* data chunk identifier */
    writeString(view, 36, 'data');
    /* data chunk length */
    view.setUint32(40, samples.length * 2, true);

    floatTo16BitPCM(view, 44, samples);

    return new Blob([view], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

function mergeBuffers(buffers: Float32Array[], length: number): Float32Array {
    const result = new Float32Array(length);
    let offset = 0;
    for (const buffer of buffers) {
        result.set(buffer, offset);
        offset += buffer.length;
    }
    return result;
}

// --- Main Service Logic ---

import { GoogleGenAI } from "@google/genai";

export async function startLiveTranscription(
    apiKey: string,
    provider: 'google' | 'openrouter' | 'sarvam',
    modelName: string,
    callbacks: LiveTranscriptionCallbacks
): Promise<void> {
    if (currentSession?.isActive) {
        await stopLiveTranscription();
    }

    callbacks.onStatusChange('connecting');

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                sampleRate: SAMPLE_RATE,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });

        // Initialize AudioContext
        // NOTE: We continue to use ScriptProcessorNode for simplicity in this single-file service.
        // AudioWorklet is preferred but requires a separate loader file.
        const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
        await audioContext.resume();

        const sourceNode = audioContext.createMediaStreamSource(stream);
        const scriptNode = audioContext.createScriptProcessor(4096, 1, 1);

        const session: LiveSession = {
            isActive: true,
            audioContext,
            mediaStream: stream,
            scriptNode,
            sourceNode,
            accumulatedData: [],
            totalSamples: 0,
            intervalId: null,
            fullAudioChunks: [],
            fullTranscript: ""
        };

        scriptNode.onaudioprocess = (e) => {
            if (!session.isActive) return;
            const inputData = e.inputBuffer.getChannelData(0);
            const dataClone = new Float32Array(inputData);

            // If sample rate doesn't match 16k, we must resample here.
            // (AudioContext constructor request might be ignored by some browsers/OS)
            let finalData = dataClone;
            if (audioContext.sampleRate !== SAMPLE_RATE) {
                finalData = resample(dataClone, audioContext.sampleRate, SAMPLE_RATE);
            }

            session.accumulatedData.push(finalData);
            session.totalSamples += finalData.length;

            // Store for final session blob (keeping full fidelity if possible, but resampled is okay for now)
            session.fullAudioChunks.push(finalData);
        };

        sourceNode.connect(scriptNode);
        scriptNode.connect(audioContext.destination);

        // Start processing interval
        session.intervalId = setInterval(async () => {
            if (!session.isActive || session.totalSamples === 0) return;

            // Extract current buffer
            const currentTotal = session.totalSamples;
            const currentChunks = [...session.accumulatedData];

            // Reset buffer immediately
            session.accumulatedData = [];
            session.totalSamples = 0;

            const merged = mergeBuffers(currentChunks, currentTotal);
            const wavBlob = encodeWAV(merged);

            // Send to Sarvam
            try {
                if (provider === 'sarvam') {
                    // SARVAM LOGIC
                    const formData = new FormData();
                    formData.append('file', wavBlob, 'audio.wav');
                    formData.append('model', 'saaras:v3');
                    // Using generic hindi/english model, user can change if needed but v3 is standard

                    const response = await fetch('https://api.sarvam.ai/speech-to-text', {
                        method: 'POST',
                        headers: { 'api-subscription-key': apiKey },
                        body: formData
                    });

                    if (response.ok) {
                        const data = await response.json();
                        if (data.transcript) {
                            const newText = data.transcript.trim();
                            if (newText) {
                                // Avoid sticky spacing
                                const separator = session.fullTranscript.length > 0 ? " " : "";
                                session.fullTranscript += separator + newText;
                                callbacks.onTranscript(newText + " ", true);
                            }
                        }
                    } else {
                        console.error('[Sarvam REST] Error:', response.status, await response.text());
                    }

                } else if (provider === 'google') {
                    // GOOGLE LOGIC (Chunked)
                    // Convert blob to base64
                    const reader = new FileReader();
                    reader.onloadend = async () => {
                        const base64data = (reader.result as string).split(',')[1];
                        const ai = new GoogleGenAI(apiKey);

                        try {
                            const response = await ai.models.generateContent({
                                model: modelName || 'gemini-2.5-flash',
                                contents: [{
                                    role: "user",
                                    parts: [
                                        { inlineData: { mimeType: 'audio/wav', data: base64data } },
                                        { text: "Transcribe this audio verbatim. Output only the text." }
                                    ]
                                }],
                                config: { temperature: 0.1 }
                            });

                            const newText = response.text?.trim();
                            if (newText) {
                                const separator = session.fullTranscript.length > 0 ? " " : "";
                                session.fullTranscript += separator + newText;
                                callbacks.onTranscript(newText + " ", true);
                            }
                        } catch (gErr) {
                            console.error('[Google Live] Error:', gErr);
                        }
                    };
                    reader.readAsDataURL(wavBlob);

                } else if (provider === 'openrouter') {
                    // OPENROUTER LOGIC
                    console.warn("OpenRouter Live Transcription is experimental.");
                    // Attempt standard OpenAI audio transcription if endpoint supported, 
                    // but OpenRouter usually routes chat completions.
                    // We'll try the 'image_url' hack or similar IF the model supports it, 
                    // but for now we'll just log that it's not fully supported.
                    // Ideally we'd throw or stop, but let's just do nothing to prevent crash loop.
                }

            } catch (err) {
                console.error(`[${provider}] Fetch error:`, err);
            }

        }, CHUNK_DURATION_MS);

        currentSession = session;
        callbacks.onStatusChange('connected');

    } catch (err: any) {
        console.error('Failed to start live session:', err);
        callbacks.onStatusChange('disconnected');
        callbacks.onError(err);
        throw err;
    }
}


/**
 * Stops the live transcription session.
 */
export async function stopLiveTranscription(): Promise<{ transcript: string; audioBlob: Blob }> {
    if (!currentSession) {
        return { transcript: "", audioBlob: new Blob([], { type: 'audio/wav' }) };
    }

    const session = currentSession;
    session.isActive = false;

    if (session.intervalId) {
        clearInterval(session.intervalId);
    }

    // Stop mic and nodes
    session.mediaStream?.getTracks().forEach(track => track.stop());
    session.scriptNode?.disconnect();
    session.sourceNode?.disconnect();
    await session.audioContext?.close();

    // Process full audio
    let finalBlob = new Blob([], { type: 'audio/wav' });
    if (session.fullAudioChunks.length > 0) {
        const totalLength = session.fullAudioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
        const merged = mergeBuffers(session.fullAudioChunks, totalLength);
        finalBlob = encodeWAV(merged);
    }

    const result = {
        transcript: session.fullTranscript,
        audioBlob: finalBlob
    };

    currentSession = null;
    return result;
}

/**
 * Check if a live session is currently active.
 */
export function isLiveActive(): boolean {
    return currentSession?.isActive || false;
}

