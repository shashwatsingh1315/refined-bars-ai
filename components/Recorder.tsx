
import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Loader2, Zap, XCircle, Radio } from 'lucide-react';
import { Button } from './Button';
import { saveAudioBackup } from '../utils/indexedDb';
import { startLiveTranscription, stopLiveTranscription, isLiveActive } from '../services/liveTranscriptionService';

import { AIProvider } from '../types';

interface RecorderProps {
  onProbe: (audioBase64: string, mimeType: string) => Promise<void>;
  onFinish: (audioBase64: string, mimeType: string) => Promise<void>;
  onLiveProbe?: (transcript: string, audioBlob: Blob) => Promise<void>;
  onLiveFinish?: (transcript: string, audioBlob: Blob) => Promise<void>;
  isProcessing: boolean;
  onCancelProcessing?: () => void;
  sessionId: string;
  paramId: string;
  transcriptionMode: 'batch' | 'live';
  googleApiKey?: string;
  sarvamApiKey?: string;
  provider?: AIProvider;
}

export const Recorder: React.FC<RecorderProps> = ({
  onProbe, onFinish, onLiveProbe, onLiveFinish,
  isProcessing, onCancelProcessing,
  sessionId, paramId,
  transcriptionMode, googleApiKey, sarvamApiKey, provider
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [timer, setTimer] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [liveTranscript, setLiveTranscript] = useState<string>('');
  const [liveStatus, setLiveStatus] = useState<'idle' | 'connecting' | 'connected' | 'disconnected'>('idle');

  // Batch mode refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // ─── BATCH MODE ───────────────────────────────────

  const startBatchRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start(1000);
      setIsRecording(true);
      setTimer(0);
      timerRef.current = window.setInterval(() => setTimer(t => t + 1), 1000);
    } catch (err) {
      setError("Microphone access denied. Please check browser permissions.");
    }
  };

  const handleBatchStop = (callback: (base64: string, type: string) => Promise<void>) => {
    if (!mediaRecorderRef.current || !isRecording) return;

    const recorder = mediaRecorderRef.current;

    recorder.onstop = async () => {
      if (chunksRef.current.length === 0) {
        setError("No audio captured. Please try recording again.");
        return;
      }

      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });

      await saveAudioBackup(blob, sessionId, paramId);

      const reader = new FileReader();

      reader.onloadend = () => {
        const result = reader.result as string;
        if (!result) {
          setError("Failed to process audio file.");
          return;
        }
        const base64String = result.split(',')[1];
        callback(base64String, blob.type);
      };

      reader.onerror = () => {
        setError("Error reading audio data.");
      };

      reader.readAsDataURL(blob);
      recorder.stream.getTracks().forEach(track => track.stop());
    };

    recorder.stop();
    setIsRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  // ─── LIVE MODE ───────────────────────────────────

  const startLiveRecording = async () => {
    setError(null);
    setLiveTranscript('');
    setLiveStatus('connecting');

    let apiKey = '';

    // Determine API Key based on provider
    // Note: Currently startLiveTranscription is implemented only for Sarvam
    // If we want to support Google Live again, we'd need to update the service to handle both.

    if (provider === 'sarvam' || provider === 'openrouter') {
      if (!sarvamApiKey) {
        setError("Sarvam API Key is required for live transcription. Please add it in Settings.");
        setLiveStatus('idle');
        return;
      }
      apiKey = sarvamApiKey;
    } else {
      // Fallback or default to Google if not Sarvam (legacy behavior)
      // But warning: service might be Sarvam-only now
      if (!googleApiKey) {
        setError("Google API Key is required. Please add it in Settings.");
        setLiveStatus('idle');
        return;
      }
      apiKey = googleApiKey;
    }


    try {
      // Default model names if not provided in settings (though they should be)
      // For OpenRouter live mode, we use Sarvam for transcription, so we force saaras:v3 or similar
      const transcriptionModel = (provider === 'sarvam' || provider === 'openrouter') ? 'saaras:v3' : 'gemini-2.5-flash';

      // We pass the effective provider for transcription. 
      // If user selected OpenRouter, we tell the service to act like 'sarvam' for the transcription part.
      const transcriptionProvider = provider === 'openrouter' ? 'sarvam' : provider;

      await startLiveTranscription(apiKey, transcriptionProvider || 'google', transcriptionModel, {
        onTranscript: (text, _isFinal) => {
          setLiveTranscript(prev => prev + text); // Append for chunked REST
        },
        onError: (err) => {
          setError(err.message);
          setLiveStatus('disconnected');
        },
        onStatusChange: (status) => {
          setLiveStatus(status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting' : 'idle');
        },
      });

      setIsRecording(true);
      setTimer(0);
      timerRef.current = window.setInterval(() => setTimer(t => t + 1), 1000);
    } catch (err: any) {
      setError(err.message || "Failed to start live transcription.");
      setLiveStatus('idle');
    }
  };


  const handleLiveStop = async (callback?: (transcript: string, audioBlob: Blob) => Promise<void>) => {
    setIsRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);

    try {
      const { transcript, audioBlob } = await stopLiveTranscription();

      // Save backup
      await saveAudioBackup(audioBlob, sessionId, paramId);

      setLiveStatus('idle');

      if (callback && transcript) {
        await callback(transcript, audioBlob);
      } else if (!transcript) {
        setError("No transcript was captured. Please try again.");
      }
    } catch (err: any) {
      setError(err.message || "Error stopping live transcription.");
      setLiveStatus('idle');
    }
  };

  // ─── UNIFIED HANDLERS ───────────────────────────

  const handleStartRecording = () => {
    if (transcriptionMode === 'live') {
      startLiveRecording();
    } else {
      startBatchRecording();
    }
  };

  const handleProbe = () => {
    if (transcriptionMode === 'live' && onLiveProbe) {
      handleLiveStop(onLiveProbe);
    } else {
      handleBatchStop(onProbe);
    }
  };

  const handleFinish = () => {
    if (transcriptionMode === 'live' && onLiveFinish) {
      handleLiveStop(onLiveFinish);
    } else {
      handleBatchStop(onFinish);
    }
  };

  // ─── HELPERS ─────────────────────────────────────

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // ─── RENDER: PROCESSING STATE ────────────────────

  if (isProcessing) {
    return (
      <div className="flex flex-col gap-6 p-8 bg-white border-[3px] border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] relative overflow-hidden">
        <div className="flex items-center gap-6">
          <Loader2 className="w-6 h-6 text-black animate-spin" />
          <div className="flex-1">
            <p className="text-sm font-black uppercase text-black tracking-tight">Analyzing responses...</p>
            <p className="text-xs font-bold text-black/60">Gemini is extracting STAR evidence and generating probes.</p>
          </div>
          {onCancelProcessing && (
            <Button variant="outline" size="sm" onClick={onCancelProcessing} className="bg-tertiary hover:bg-tertiary">
              <XCircle className="w-4 h-4 mr-2" /> Cancel
            </Button>
          )}
        </div>
        <div className="absolute bottom-0 left-0 h-2 bg-black/10 w-full overflow-hidden">
          <div className="h-full bg-quat w-1/2 animate-[shimmer_2s_infinite]"></div>
        </div>
      </div>
    );
  }

  // ─── RENDER: MAIN ────────────────────────────────

  return (
    <div className="space-y-6">
      {error && (
        <div className="text-black text-[11px] font-black uppercase bg-tertiary p-4 border-[3px] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex items-center gap-3">
          <XCircle className="w-5 h-5 shrink-0" />
          {error}
        </div>
      )}

      {!isRecording ? (
        <Button
          onClick={handleStartRecording}
          size="lg"
          className="w-full h-20 text-xl bg-main shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] group"
        >
          <Mic className="w-6 h-6 mr-4 group-hover:scale-110 transition-transform" />
          {transcriptionMode === 'live' ? 'RECORD (LIVE)' : 'RECORD RESPONSE'}
        </Button>
      ) : (
        <div className="space-y-4">
          {/* Live transcript display */}
          {transcriptionMode === 'live' && (
            <div className="bg-slate-50 border-[3px] border-black p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <div className="flex items-center gap-2 mb-2">
                <Radio className="w-4 h-4 text-black animate-pulse" />
                <span className="text-[10px] font-black text-black uppercase tracking-widest">
                  {liveStatus === 'connecting' ? 'Connecting...' : 'Live Transcript'}
                </span>
              </div>
              <div className="text-sm font-bold text-black leading-relaxed min-h-[60px] max-h-40 overflow-y-auto whitespace-pre-wrap">
                {liveTranscript || (liveStatus === 'connecting'
                  ? 'Establishing connection to Gemini...'
                  : 'Listening... start speaking.'
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Button
              onClick={handleProbe}
              variant="secondary"
              className="h-20 bg-secondary text-black border-[3px] border-black"
            >
              <Zap className="w-5 h-5 mr-2 text-black fill-black" />
              ANALYZE & PROBE
            </Button>
            <Button
              onClick={handleFinish}
              variant="primary"
              className="h-20 bg-black text-white"
            >
              <Square className="w-4 h-4 mr-2 fill-white" />
              FINISH QUESTION
            </Button>
            <div className="col-span-2 flex items-center justify-center py-2">
              <div className="inline-flex items-center gap-3 px-4 py-2 bg-secondary border-[3px] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <span className={`w-3 h-3 animate-pulse ${transcriptionMode === 'live' ? 'bg-main' : 'bg-black'}`}></span>
                <span className="text-[12px] font-black text-black tabular-nums uppercase tracking-widest">{formatTime(timer)} recording</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
