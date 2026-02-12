
import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Loader2, Zap, XCircle } from 'lucide-react';
import { Button } from './Button';
import { saveAudioBackup } from '../utils/indexedDb';

interface RecorderProps {
  onProbe: (audioBase64: string, mimeType: string) => Promise<void>;
  onFinish: (audioBase64: string, mimeType: string) => Promise<void>;
  isProcessing: boolean;
  onCancelProcessing?: () => void;
  sessionId: string;
  paramId: string;
}

export const Recorder: React.FC<RecorderProps> = ({ onProbe, onFinish, isProcessing, onCancelProcessing, sessionId, paramId }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [timer, setTimer] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      // Use a timeslice to ensure dataavailable fires periodically
      recorder.start(1000);
      setIsRecording(true);
      setTimer(0);
      timerRef.current = window.setInterval(() => setTimer(t => t + 1), 1000);
    } catch (err) {
      setError("Microphone access denied. Please check browser permissions.");
    }
  };

  const handleStop = (callback: (base64: string, type: string) => Promise<void>) => {
    if (!mediaRecorderRef.current || !isRecording) return;

    const recorder = mediaRecorderRef.current;

    recorder.onstop = async () => {
      if (chunksRef.current.length === 0) {
        setError("No audio captured. Please try recording again.");
        return;
      }

      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });

      // Save backup immediately
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

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

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
          onClick={startRecording}
          size="lg"
          className="w-full h-20 text-xl bg-main shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] group"
        >
          <Mic className="w-6 h-6 mr-4 group-hover:scale-110 transition-transform" />
          RECORD RESPONSE
        </Button>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <Button
            onClick={() => handleStop(onProbe)}
            variant="secondary"
            className="h-20 bg-secondary text-black border-[3px] border-black"
          >
            <Zap className="w-5 h-5 mr-2 text-black fill-black" />
            ANALYZE & PROBE
          </Button>
          <Button
            onClick={() => handleStop(onFinish)}
            variant="primary"
            className="h-20 bg-black text-white"
          >
            <Square className="w-4 h-4 mr-2 fill-white" />
            FINISH QUESTION
          </Button>
          <div className="col-span-2 flex items-center justify-center py-2">
            <div className="inline-flex items-center gap-3 px-4 py-2 bg-secondary border-[3px] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <span className="w-3 h-3 bg-black animate-pulse"></span>
              <span className="text-[12px] font-black text-black tabular-nums uppercase tracking-widest">{formatTime(timer)} recording</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

