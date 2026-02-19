
import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Loader2, Zap, XCircle, Radio, Plus } from 'lucide-react';
import { Button } from './Button';
import { saveAudioBackup } from '../utils/indexedDb';
import { startLiveTranscription, stopLiveTranscription, isLiveActive } from '../services/liveTranscriptionService';

import { AIProvider } from '../types';

interface RecorderProps {
  // Phase 2: Stop & Transcribe only
  onStopAndTranscribe: (audioBase64: string, mimeType: string) => Promise<void>;
  onLiveStopAndTranscribe?: (transcript: string, audioBlob: Blob) => Promise<void>;
  // Phase 3: Analyze actions (text-only, no audio)
  onAnalyzeProbe: () => Promise<void>;
  onAnalyzeFinish: () => Promise<void>;
  isProcessing: boolean;
  onCancelProcessing?: () => void;
  sessionId: string;
  paramId: string;
  transcriptionMode: 'batch' | 'live';
  googleApiKey?: string;
  sarvamApiKey?: string;
  provider?: AIProvider;
  hasTranscript: boolean; // Whether there's already transcript text for this question
}

type RecorderPhase = 'idle' | 'recording' | 'transcribing' | 'ready';

export const Recorder: React.FC<RecorderProps> = ({
  onStopAndTranscribe, onLiveStopAndTranscribe,
  onAnalyzeProbe, onAnalyzeFinish,
  isProcessing, onCancelProcessing,
  sessionId, paramId,
  transcriptionMode, googleApiKey, sarvamApiKey, provider,
  hasTranscript
}) => {
  const [phase, setPhase] = useState<RecorderPhase>(hasTranscript ? 'ready' : 'idle');
  const [timer, setTimer] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [liveTranscript, setLiveTranscript] = useState<string>('');
  const [liveStatus, setLiveStatus] = useState<'idle' | 'connecting' | 'connected' | 'disconnected'>('idle');

  // Batch mode refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  // Update phase when hasTranscript changes (e.g., navigating between questions)
  useEffect(() => {
    if (hasTranscript && phase === 'idle') {
      setPhase('ready');
    } else if (!hasTranscript && phase === 'ready') {
      setPhase('idle');
    }
  }, [hasTranscript]);

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
      setPhase('recording');
      setTimer(0);
      timerRef.current = window.setInterval(() => setTimer(t => t + 1), 1000);
    } catch (err) {
      setError("Microphone access denied. Please check browser permissions.");
    }
  };

  const stopBatchRecording = () => {
    if (!mediaRecorderRef.current || phase !== 'recording') return;

    const recorder = mediaRecorderRef.current;

    recorder.onstop = async () => {
      if (chunksRef.current.length === 0) {
        setError("No audio captured. Please try recording again.");
        setPhase('idle');
        return;
      }

      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });

      await saveAudioBackup(blob, sessionId, paramId);

      const reader = new FileReader();

      reader.onloadend = async () => {
        const result = reader.result as string;
        if (!result) {
          setError("Failed to process audio file.");
          setPhase('idle');
          return;
        }
        const base64String = result.split(',')[1];
        setPhase('transcribing');
        try {
          await onStopAndTranscribe(base64String, blob.type);
          setPhase('ready');
        } catch (err: any) {
          setError(err.message || "Transcription failed.");
          setPhase('idle');
        }
      };

      reader.onerror = () => {
        setError("Error reading audio data.");
        setPhase('idle');
      };

      reader.readAsDataURL(blob);
      recorder.stream.getTracks().forEach(track => track.stop());
    };

    recorder.stop();
    if (timerRef.current) clearInterval(timerRef.current);
  };

  // ─── LIVE MODE ───────────────────────────────────

  const startLiveRecording = async () => {
    setError(null);
    setLiveTranscript('');
    setLiveStatus('connecting');

    let apiKey = '';

    if (provider === 'sarvam' || provider === 'openrouter') {
      if (!sarvamApiKey) {
        setError("Sarvam API Key is required for live transcription. Please add it in Settings.");
        setLiveStatus('idle');
        return;
      }
      apiKey = sarvamApiKey;
    } else {
      if (!googleApiKey) {
        setError("Google API Key is required. Please add it in Settings.");
        setLiveStatus('idle');
        return;
      }
      apiKey = googleApiKey;
    }

    try {
      const transcriptionModel = (provider === 'sarvam' || provider === 'openrouter') ? 'saaras:v3' : 'gemini-2.5-flash';
      const transcriptionProvider = provider === 'openrouter' ? 'sarvam' : provider;

      await startLiveTranscription(apiKey, transcriptionProvider || 'google', transcriptionModel, {
        onTranscript: (text, _isFinal) => {
          setLiveTranscript(prev => prev + text);
        },
        onError: (err) => {
          setError(err.message);
          setLiveStatus('disconnected');
        },
        onStatusChange: (status) => {
          setLiveStatus(status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting' : 'idle');
        },
      });

      setPhase('recording');
      setTimer(0);
      timerRef.current = window.setInterval(() => setTimer(t => t + 1), 1000);
    } catch (err: any) {
      setError(err.message || "Failed to start live transcription.");
      setLiveStatus('idle');
    }
  };

  const stopLiveRecording = async () => {
    if (timerRef.current) clearInterval(timerRef.current);

    try {
      setPhase('transcribing');
      const { transcript, audioBlob } = await stopLiveTranscription();

      // Save backup
      await saveAudioBackup(audioBlob, sessionId, paramId);

      setLiveStatus('idle');

      if (transcript && onLiveStopAndTranscribe) {
        await onLiveStopAndTranscribe(transcript, audioBlob);
        setPhase('ready');
      } else if (!transcript) {
        setError("No transcript was captured. Please try again.");
        setPhase('idle');
      } else {
        setPhase('ready');
      }
    } catch (err: any) {
      setError(err.message || "Error stopping live transcription.");
      setLiveStatus('idle');
      setPhase('idle');
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

  const handleStopRecording = () => {
    if (transcriptionMode === 'live') {
      stopLiveRecording();
    } else {
      stopBatchRecording();
    }
  };

  const handleAnalyzeProbe = async () => {
    try {
      await onAnalyzeProbe();
    } catch (err: any) {
      setError(err.message || "Analysis failed.");
    }
  };

  const handleAnalyzeFinish = async () => {
    try {
      await onAnalyzeFinish();
    } catch (err: any) {
      setError(err.message || "Analysis failed.");
    }
  };

  // ─── HELPERS ─────────────────────────────────────

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // ─── RENDER: PROCESSING STATE ────────────────────

  if (isProcessing || phase === 'transcribing') {
    const label = phase === 'transcribing' ? 'Transcribing audio...' : 'Analyzing responses...';
    const desc = phase === 'transcribing'
      ? 'Converting speech to text. This may take a moment.'
      : 'Extracting STAR evidence and generating probes.';

    return (
      <div className="flex flex-col gap-6 p-8 bg-white border-[3px] border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] relative overflow-hidden">
        <div className="flex items-center gap-6">
          <Loader2 className="w-6 h-6 text-black animate-spin" />
          <div className="flex-1">
            <p className="text-sm font-black uppercase text-black tracking-tight">{label}</p>
            <p className="text-xs font-bold text-black/60">{desc}</p>
          </div>
          {onCancelProcessing && phase !== 'transcribing' && (
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

      {/* PHASE: IDLE — Show Record button */}
      {phase === 'idle' && (
        <Button
          onClick={handleStartRecording}
          size="lg"
          className="w-full h-20 text-xl bg-main shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] group"
        >
          <Mic className="w-6 h-6 mr-4 group-hover:scale-110 transition-transform" />
          {transcriptionMode === 'live' ? 'RECORD (LIVE)' : 'RECORD RESPONSE'}
        </Button>
      )}

      {/* PHASE: RECORDING — Show Stop button only */}
      {phase === 'recording' && (
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
                  ? 'Establishing connection...'
                  : 'Listening... start speaking.'
                )}
              </div>
            </div>
          )}

          {/* Stop Recording button — full width */}
          <Button
            onClick={handleStopRecording}
            variant="primary"
            className="w-full h-20 bg-black text-white text-xl"
          >
            <Square className="w-5 h-5 mr-3 fill-white" />
            STOP RECORDING
          </Button>

          {/* Timer */}
          <div className="flex items-center justify-center py-2">
            <div className="inline-flex items-center gap-3 px-4 py-2 bg-secondary border-[3px] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <span className={`w-3 h-3 animate-pulse ${transcriptionMode === 'live' ? 'bg-main' : 'bg-black'}`}></span>
              <span className="text-[12px] font-black text-black tabular-nums uppercase tracking-widest">{formatTime(timer)} recording</span>
            </div>
          </div>
        </div>
      )}

      {/* PHASE: READY — Show Record More, Analyze & Probe, End Question */}
      {phase === 'ready' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Button
              onClick={handleStartRecording}
              variant="outline"
              className="h-20 bg-white text-black border-[3px] border-black flex flex-col items-center justify-center gap-1"
            >
              <Plus className="w-5 h-5" />
              <span className="text-[10px] font-black uppercase tracking-wider">Record More</span>
            </Button>
            <Button
              onClick={handleAnalyzeProbe}
              variant="secondary"
              className="h-20 bg-secondary text-black border-[3px] border-black flex flex-col items-center justify-center gap-1"
            >
              <Zap className="w-5 h-5 fill-black" />
              <span className="text-[10px] font-black uppercase tracking-wider">Analyze & Probe</span>
            </Button>
            <Button
              onClick={handleAnalyzeFinish}
              variant="primary"
              className="h-20 bg-black text-white flex flex-col items-center justify-center gap-1"
            >
              <Square className="w-4 h-4 fill-white" />
              <span className="text-[10px] font-black uppercase tracking-wider">End Question</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
