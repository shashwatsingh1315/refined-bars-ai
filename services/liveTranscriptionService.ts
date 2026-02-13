
import { GoogleGenAI, Modality } from '@google/genai';

export interface LiveTranscriptionCallbacks {
    onTranscript: (text: string, isFinal: boolean) => void;
    onError: (error: Error) => void;
    onStatusChange: (status: 'connecting' | 'connected' | 'disconnected') => void;
}

interface LiveSession {
    session: any;
    audioContext: AudioContext | null;
    mediaStream: MediaStream | null;
    workletNode: AudioWorkletNode | null;
    sourceNode: MediaStreamAudioSourceNode | null;
    accumulatedTranscript: string;
    audioChunks: Float32Array[];
    isActive: boolean;
}

let currentSession: LiveSession | null = null;

/**
 * Converts Float32 PCM samples to 16-bit PCM and then to base64.
 */
function float32ToPcm16Base64(float32Array: Float32Array): string {
    const pcm16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    const bytes = new Uint8Array(pcm16.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Downsamples audio from source sample rate to target sample rate.
 */
function downsample(buffer: Float32Array, fromRate: number, toRate: number): Float32Array {
    if (fromRate === toRate) return buffer;
    const ratio = fromRate / toRate;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
        const index = Math.round(i * ratio);
        result[i] = buffer[Math.min(index, buffer.length - 1)];
    }
    return result;
}

/**
 * Creates an inline AudioWorklet processor as a Blob URL.
 * This avoids needing a separate file served from public/.
 */
function createWorkletProcessorUrl(): string {
    const processorCode = `
    class PcmCaptureProcessor extends AudioWorkletProcessor {
      constructor() {
        super();
        this._bufferSize = 4096; // ~256ms at 16kHz
        this._buffer = new Float32Array(this._bufferSize);
        this._writeIndex = 0;
      }

      process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (input && input.length > 0) {
          const channelData = input[0]; // mono
          for (let i = 0; i < channelData.length; i++) {
            this._buffer[this._writeIndex++] = channelData[i];
            if (this._writeIndex >= this._bufferSize) {
              this.port.postMessage({ audioData: this._buffer.slice() });
              this._writeIndex = 0;
            }
          }
        }
        return true; // keep processor alive
      }
    }
    registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
  `;
    const blob = new Blob([processorCode], { type: 'application/javascript' });
    return URL.createObjectURL(blob);
}

/**
 * Starts a live transcription session.
 */
export async function startLiveTranscription(
    googleApiKey: string,
    callbacks: LiveTranscriptionCallbacks
): Promise<void> {
    // Clean up any existing session
    if (currentSession?.isActive) {
        await stopLiveTranscription();
    }

    callbacks.onStatusChange('connecting');

    try {
        const ai = new GoogleGenAI({ apiKey: googleApiKey });

        const config = {
            responseModalities: [Modality.TEXT],
            inputAudioTranscription: {},
            systemInstruction:
                'You are a transcription assistant. The speaker uses Hinglish (Hindi-English code-switching). ' +
                'Transcribe everything verbatim, preserving the original language mix. ' +
                'Do not translate — keep Hindi words in romanized form as spoken.'
        };

        const session: LiveSession = {
            session: null,
            audioContext: null,
            mediaStream: null,
            workletNode: null,
            sourceNode: null,
            accumulatedTranscript: '',
            audioChunks: [],
            isActive: true,
        };

        // Connect to Gemini Live API
        const liveSession = await ai.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-12-2025',
            config: config,
            callbacks: {
                onopen: () => {
                    console.log('[Live] Connected to Gemini Live API');
                    callbacks.onStatusChange('connected');
                },
                onmessage: (message: any) => {
                    // Handle input transcription (what the user said)
                    if (message.serverContent?.inputTranscription?.text) {
                        const text = message.serverContent.inputTranscription.text;
                        session.accumulatedTranscript += text;
                        callbacks.onTranscript(session.accumulatedTranscript, false);
                    }
                    // Handle model text response (if any)
                    if (message.serverContent?.modelTurn?.parts) {
                        for (const part of message.serverContent.modelTurn.parts) {
                            if (part.text) {
                                // Model might also return text — append it
                                session.accumulatedTranscript += part.text;
                                callbacks.onTranscript(session.accumulatedTranscript, false);
                            }
                        }
                    }
                },
                onerror: (e: any) => {
                    console.error('[Live] WebSocket error:', e);
                    callbacks.onError(new Error(e.message || 'Live API connection error'));
                },
                onclose: (e: any) => {
                    console.log('[Live] WebSocket closed:', e?.reason || 'unknown');
                    callbacks.onStatusChange('disconnected');
                },
            },
        });

        session.session = liveSession;

        // Setup browser mic capture
        const mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                sampleRate: 16000,
                echoCancellation: true,
                noiseSuppression: true,
            }
        });
        session.mediaStream = mediaStream;

        const audioContext = new AudioContext({ sampleRate: 16000 });
        session.audioContext = audioContext;

        // If browser doesn't support 16kHz, we'll downsample
        const actualSampleRate = audioContext.sampleRate;

        // Load AudioWorklet processor
        const workletUrl = createWorkletProcessorUrl();
        await audioContext.audioWorklet.addModule(workletUrl);
        URL.revokeObjectURL(workletUrl);

        const sourceNode = audioContext.createMediaStreamSource(mediaStream);
        session.sourceNode = sourceNode;

        const workletNode = new AudioWorkletNode(audioContext, 'pcm-capture-processor');
        session.workletNode = workletNode;

        workletNode.port.onmessage = (event) => {
            if (!session.isActive) return;

            let audioData: Float32Array = event.data.audioData;

            // Store raw chunk for backup
            session.audioChunks.push(new Float32Array(audioData));

            // Downsample if needed
            if (actualSampleRate !== 16000) {
                audioData = downsample(audioData, actualSampleRate, 16000);
            }

            // Convert to base64 PCM16 and send
            const base64Data = float32ToPcm16Base64(audioData);
            try {
                liveSession.sendRealtimeInput({
                    audio: {
                        data: base64Data,
                        mimeType: 'audio/pcm;rate=16000'
                    }
                });
            } catch (err) {
                console.warn('[Live] Failed to send audio chunk:', err);
            }
        };

        sourceNode.connect(workletNode);
        workletNode.connect(audioContext.destination); // needed to keep the worklet alive

        currentSession = session;
    } catch (err: any) {
        console.error('[Live] Failed to start:', err);
        callbacks.onStatusChange('disconnected');
        callbacks.onError(new Error(err.message || 'Failed to start live transcription'));
        throw err;
    }
}

/**
 * Stops the live transcription session and returns the accumulated transcript + backup audio blob.
 */
export async function stopLiveTranscription(): Promise<{
    transcript: string;
    audioBlob: Blob;
    mimeType: string;
}> {
    if (!currentSession) {
        return { transcript: '', audioBlob: new Blob(), mimeType: 'audio/wav' };
    }

    const session = currentSession;
    session.isActive = false;

    // Close WebSocket
    try {
        session.session?.close?.();
    } catch (e) {
        console.warn('[Live] Error closing session:', e);
    }

    // Stop mic
    if (session.mediaStream) {
        session.mediaStream.getTracks().forEach(track => track.stop());
    }

    // Disconnect audio nodes
    try {
        session.workletNode?.disconnect();
        session.sourceNode?.disconnect();
        await session.audioContext?.close();
    } catch (e) {
        console.warn('[Live] Error closing audio context:', e);
    }

    // Build backup WAV blob from raw chunks
    const audioBlob = buildWavBlob(session.audioChunks, session.audioContext?.sampleRate || 16000);
    const transcript = session.accumulatedTranscript;

    currentSession = null;

    return {
        transcript,
        audioBlob,
        mimeType: 'audio/wav',
    };
}

/**
 * Check if a live session is currently active.
 */
export function isLiveActive(): boolean {
    return currentSession?.isActive || false;
}

/**
 * Builds a WAV file blob from Float32 PCM chunks.
 */
function buildWavBlob(chunks: Float32Array[], sampleRate: number): Blob {
    // Calculate total length
    let totalLength = 0;
    for (const chunk of chunks) {
        totalLength += chunk.length;
    }

    // Merge all chunks
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
    }

    // Convert to 16-bit PCM
    const pcm16 = new Int16Array(merged.length);
    for (let i = 0; i < merged.length; i++) {
        const s = Math.max(-1, Math.min(1, merged[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    // Build WAV header
    const wavBuffer = new ArrayBuffer(44 + pcm16.length * 2);
    const view = new DataView(wavBuffer);

    // RIFF header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + pcm16.length * 2, true);
    writeString(view, 8, 'WAVE');

    // fmt chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // chunk size
    view.setUint16(20, 1, true);  // PCM format
    view.setUint16(22, 1, true);  // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true);  // block align
    view.setUint16(34, 16, true); // bits per sample

    // data chunk
    writeString(view, 36, 'data');
    view.setUint32(40, pcm16.length * 2, true);

    // Write PCM data
    const dataBytes = new Uint8Array(wavBuffer, 44);
    const pcmBytes = new Uint8Array(pcm16.buffer);
    dataBytes.set(pcmBytes);

    return new Blob([wavBuffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
    }
}
