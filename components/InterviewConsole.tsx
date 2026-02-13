import React, { useState, useEffect } from 'react';
import { useInterview } from '../context/InterviewContext';
import { analyzeAndProbe, transcribeAudio, analyzeTranscript, regenerateQuestionAnalysis } from '../services/geminiService';
import { Recorder } from './Recorder';
import { Button } from './Button';
import { SettingsModal } from './SettingsModal';
import {
  ArrowLeft, ArrowRight, CheckCircle2,
  FileText, Sparkles, MessageSquare, Info, X, LayoutGrid, Zap, AlertCircle, RefreshCcw, Settings2, Radio
} from 'lucide-react';
import { getQuestionAudio } from '../utils/indexedDb';

export const InterviewConsole: React.FC = () => {
  const { rubric, settings, results, updateResult, resetInterview, setIsFinished, sessionId } = useInterview();
  const [showSettings, setShowSettings] = useState(false);
  const [showRatingGuide, setShowRatingGuide] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probingQuestions, setProbingQuestions] = useState<string[]>([]);
  const [transcriptionMode, setTranscriptionMode] = useState<'batch' | 'live'>(settings.transcriptionMode || 'batch');

  // Initialize currentIndex from localStorage
  const [currentIndex, setCurrentIndex] = useState(() => {
    const saved = localStorage.getItem('bars_currentIndex');
    return saved ? parseInt(saved) : 0;
  });

  // Persist currentIndex
  useEffect(() => {
    localStorage.setItem('bars_currentIndex', currentIndex.toString());
  }, [currentIndex]);

  const currentItem = rubric[currentIndex];
  // Ensure we have a default result object if none exists yet
  const currentResult = results[currentItem.id] || {
    transcript: '',
    rating: 0,
    isEdited: false,
    starEvidence: { situation: '', task: '', action: '', result: '' }
  };

  const isParameterComplete = !!currentResult.transcript && currentResult.starEvidence && Object.values(currentResult.starEvidence).some(v => !!v);

  const handleNext = () => {
    if (currentIndex < rubric.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setProbingQuestions([]);
      setError(null);
    } else {
      setIsFinished(true);
    }
  };

  const handleProbe = async (audioBase64: string, mimeType: string) => {
    setIsProcessing(true);
    setError(null);
    try {
      const { newTranscriptSnippet, starUpdate, probingQuestions } = await analyzeAndProbe(
        settings, // Pass full settings object (provider + key + model)
        audioBase64,
        mimeType,
        currentItem,
        currentResult.transcript,
        currentResult.starEvidence
      );

      const updatedTranscript = currentResult.transcript +
        (currentResult.transcript ? "\n\n" : "") +
        "CANDIDATE: " + (newTranscriptSnippet || "") +
        "\n\nINTERVIEWER (PROBE): " + (probingQuestions?.[0] || "");

      updateResult(currentItem.id, {
        transcript: updatedTranscript,
        starEvidence: starUpdate
      });
      setProbingQuestions(probingQuestions || []);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An unexpected error occurred during analysis.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFinishQuestion = async (audioBase64: string, mimeType: string) => {
    setIsProcessing(true);
    setError(null);
    try {
      // Step 1: Transcribe the audio completely
      const transcript = await transcribeAudio(
        settings,
        audioBase64,
        mimeType
      );

      const updatedTranscript = currentResult.transcript +
        (currentResult.transcript ? "\n\n" : "") +
        "CANDIDATE: " + (transcript || "");

      // Step 2: Analyze the transcript for STAR evidence (no probing questions needed)
      const { starUpdate } = await analyzeTranscript(
        settings,
        transcript,
        currentItem,
        currentResult.transcript,
        currentResult.starEvidence,
        false // Do NOT generate probing questions (question is finished)
      );

      updateResult(currentItem.id, {
        transcript: updatedTranscript,
        starEvidence: starUpdate
      });
      setProbingQuestions([]); // Clear probing questions since we're done
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to finalize the question transcription.");
    } finally {
      setIsProcessing(false);
    }
  };

  // ─── LIVE MODE HANDLERS ──────────────────────────

  const handleLiveProbe = async (transcript: string, audioBlob: Blob) => {
    setIsProcessing(true);
    setError(null);
    try {
      // We already have the transcript from live mode — go straight to analysis
      const { starUpdate, probingQuestions: newProbes } = await analyzeTranscript(
        settings,
        transcript,
        currentItem,
        currentResult.transcript,
        currentResult.starEvidence,
        true // Generate probing questions
      );

      const updatedTranscript = currentResult.transcript +
        (currentResult.transcript ? "\n\n" : "") +
        "CANDIDATE: " + transcript +
        "\n\nINTERVIEWER (PROBE): " + (newProbes?.[0] || "");

      updateResult(currentItem.id, {
        transcript: updatedTranscript,
        starEvidence: starUpdate,
      });
      setProbingQuestions(newProbes || []);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Analysis failed on live transcript.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLiveFinish = async (transcript: string, audioBlob: Blob) => {
    setIsProcessing(true);
    setError(null);
    try {
      const updatedTranscript = currentResult.transcript +
        (currentResult.transcript ? "\n\n" : "") +
        "CANDIDATE: " + transcript;

      const { starUpdate } = await analyzeTranscript(
        settings,
        transcript,
        currentItem,
        currentResult.transcript,
        currentResult.starEvidence,
        false
      );

      updateResult(currentItem.id, {
        transcript: updatedTranscript,
        starEvidence: starUpdate,
      });
      setProbingQuestions([]);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to finalize live transcript.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRegenerate = async () => {
    setIsProcessing(true);
    setError(null);
    try {
      if (!sessionId) throw new Error("No session ID found.");

      const audioBlobs = await getQuestionAudio(sessionId, currentItem.id);
      if (audioBlobs.length === 0) {
        throw new Error("No recordings found for this question to regenerate.");
      }

      const blobData = audioBlobs.map(b => ({ blob: b.blob, mimeType: b.mimeType }));

      const { transcript, starUpdate, probingQuestions: newProbes } = await regenerateQuestionAnalysis(
        settings,
        blobData,
        currentItem
      );

      updateResult(currentItem.id, {
        transcript: transcript,
        starEvidence: starUpdate
      });
      setProbingQuestions(newProbes || []);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Regeneration failed.");
    } finally {
      setIsProcessing(false);
    }
  };


  return (
    <div className="flex h-screen font-sans overflow-hidden bg-white">
      {/* Sidebar - Navigation */}
      <aside className="w-80 bg-secondary border-r-[3px] border-black flex flex-col shrink-0">

        {/* Header */}
        <div className="p-6 border-b-[3px] border-black bg-main">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 bg-black flex items-center justify-center text-main border-2 border-black">
              <LayoutGrid className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-black text-black uppercase tracking-tight">Session Navigator</h2>
          </div>
          <p className="text-sm font-black text-black uppercase tracking-widest opacity-60">Candidate</p>
          <p className="text-xl font-black text-black truncate">{settings.candidateName}</p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {rubric.map((item, idx) => {
            const isActive = idx === currentIndex;
            const isDone = !!results[item.id]?.transcript;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setCurrentIndex(idx);
                  setProbingQuestions([]);
                  setError(null);
                }}
                className={`w-full text-left p-3 border-[3px] border-black transition-all flex items-center gap-3 group ${isActive ? 'bg-black text-white shadow-none translate-x-[2px] translate-y-[2px]' : 'bg-white text-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]'
                  }`}
              >
                <span className={`w-10 h-10 border-2 border-current flex items-center justify-center text-sm font-black shrink-0 ${isActive ? 'bg-main text-white' : 'bg-black text-white'
                  }`}>
                  {idx + 1}
                </span>
                <span className="truncate text-base font-black uppercase tracking-tight flex-1">{item.parameter}</span>
                {isDone && <CheckCircle2 className={`w-4 h-4 ${isActive ? 'text-main' : 'text-main-accent'}`} />}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-4 border-t-[3px] border-black bg-white">
          <Button variant="destructive" size="sm" className="w-full justify-start" onClick={resetInterview}>
            Abandon Session
          </Button>
        </div>
      </aside >

      {/* Main Panel */}
      < main className="flex-1 flex flex-col min-w-0 bg-white z-10" >

        {/* Header */}
        < header className="px-8 h-20 border-b-[3px] border-black flex items-center justify-between bg-white" >

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex w-12 h-12 border-[3px] border-black bg-quat items-center justify-center shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <MessageSquare className="w-6 h-6 text-black" />
            </div>
            <div>
              <span className="text-[10px] font-black text-black uppercase tracking-widest block opacity-60">{currentItem.competency}</span>
              <h1 className="text-xl font-black text-black uppercase tracking-tight leading-tight truncate max-w-xs">{currentItem.parameter}</h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Transcription Mode Toggle */}
            <div className="flex items-center border-[3px] border-black overflow-hidden shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
              <button
                onClick={() => setTranscriptionMode('batch')}
                className={`px-3 py-2 text-[10px] font-black uppercase tracking-wider transition-all ${transcriptionMode === 'batch'
                  ? 'bg-black text-white'
                  : 'bg-white text-black hover:bg-slate-100'
                  }`}
              >
                Batch
              </button>
              <button
                onClick={() => {
                  const hasGoogle = !!settings.googleApiKey;
                  const hasSarvam = !!settings.sarvamApiKey;

                  if (settings.provider === 'google' && !hasGoogle) {
                    setError('Live mode requires a Google API Key. Please add it in Settings.');
                    return;
                  }
                  if (settings.provider === 'sarvam' && !hasSarvam) {
                    setError('Live mode requires a Sarvam API Key. Please add it in Settings.');
                    return;
                  }
                  if (settings.provider === 'openrouter' && !hasSarvam) {
                    setError('Live mode with OpenRouter requires a Sarvam API Key for transcription. Please add it in Settings.');
                    return;
                  }

                  // Allow Google, Sarvam, AND OpenRouter (if Sarvam key exists)
                  setTranscriptionMode('live');
                }}
                className={`px-3 py-2 text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-1 ${transcriptionMode === 'live'
                  ? 'bg-main text-white'
                  : 'bg-white text-black hover:bg-slate-100'
                  } `}
                title={'Real-time transcription'}
              >
                <Radio className="w-3 h-3" /> Live
              </button>
            </div>

            <div className="h-10 w-[3px] bg-black mx-1"></div>
            <Button variant="outline" size="sm" onClick={() => setShowSettings(true)} className="bg-white hover:bg-slate-100">
              <Settings2 className="w-4 h-4 mr-2" /> Settings
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowRatingGuide(true)} className="bg-secondary">
              <Info className="w-4 h-4 mr-2" /> Rubric
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleRegenerate}
              disabled={isProcessing}
              className="bg-white border-black hover:bg-black hover:text-white"
              title="Re-analyze all audio for this question"
            >
              <RefreshCcw className={`w-4 h-4 ${isProcessing ? 'animate-spin' : ''}`} />
            </Button>
            <div className="h-10 w-[3px] bg-black mx-1"></div>
            <Button onClick={() => { setCurrentIndex(Math.max(0, currentIndex - 1)); setError(null); }} disabled={currentIndex === 0} variant="outline" size="sm">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <Button onClick={handleNext} variant="primary" size="sm">
              {currentIndex === rubric.length - 1 ? 'Final Report' : 'Next'}
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </div>
        </header >

        <div className="flex-1 overflow-y-auto p-8 space-y-12">
          {/* Question Display */}
          <div className="max-w-3xl mx-auto space-y-12">
            <div className="bg-main border-[3px] border-black p-10 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] relative">
              <span className="absolute -top-4 left-8 px-3 py-1 bg-black text-[10px] font-black text-white uppercase tracking-widest border-[3px] border-black">Interview Question</span>
              <p className="text-2xl font-black text-black leading-tight italic">
                "{currentItem.question}"
              </p>
            </div>

            {/* Interaction Area */}
            <div className="max-w-2xl mx-auto space-y-6">
              {error && (
                <div className="bg-tertiary border-[3px] border-black text-black p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] flex items-start gap-4">
                  <AlertCircle className="w-6 h-6 shrink-0 mt-1" />
                  <div className="flex-1">
                    <p className="text-sm font-black uppercase">Analysis Failed</p>
                    <p className="text-xs font-bold opacity-80">{error}</p>
                  </div>
                  <button onClick={() => setError(null)} className="text-black hover:scale-110 transition-transform">
                    <X className="w-5 h-5 stroke-[3px]" />
                  </button>
                </div>
              )}
              <Recorder
                onProbe={handleProbe}
                onFinish={handleFinishQuestion}
                onLiveProbe={handleLiveProbe}
                onLiveFinish={handleLiveFinish}
                isProcessing={isProcessing}
                onCancelProcessing={() => setIsProcessing(false)}
                sessionId={sessionId}
                paramId={currentItem.id}
                transcriptionMode={transcriptionMode}
                googleApiKey={settings.googleApiKey}
                sarvamApiKey={settings.sarvamApiKey}
                provider={settings.provider}
              />
            </div>

            {/* Transcript Log */}
            <div className="space-y-4">
              <div className="flex items-center gap-3 px-1">
                <FileText className="w-5 h-5 text-black" />
                <h3 className="text-xs font-black uppercase tracking-widest text-black">Transcript Log</h3>
                {currentResult.transcript && (
                  <div className="ml-auto text-[10px] px-3 py-1 bg-main text-white border-2 border-black font-black uppercase tracking-widest">
                    RECORDING SAVED
                  </div>
                )}
              </div>

              {currentResult.transcript ? (
                <div className="bg-white border-[3px] border-black p-8 text-sm text-black font-bold leading-relaxed font-mono whitespace-pre-wrap max-h-96 overflow-y-auto shadow-[inset_4px_4px_0px_0px_rgba(0,0,0,0.1)]">
                  {currentResult.transcript}
                </div>
              ) : (
                <div className="h-48 border-[3px] border-dashed border-black bg-slate-50 flex flex-col items-center justify-center text-black">
                  <p className="text-xs font-black uppercase opacity-30">No responses recorded yet</p>
                </div>
              )}
            </div>

            {/* Notes Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-3 px-1">
                <FileText className="w-5 h-5 text-black" />
                <h3 className="text-xs font-black uppercase tracking-widest text-black">Interviewer Notes</h3>
              </div>
              <textarea
                value={currentResult.notes || ''}
                onChange={(e) => updateResult(currentItem.id, { notes: e.target.value })}
                placeholder="Add your notes, observations, or concerns about this parameter..."
                className="w-full bg-white border-[3px] border-black p-6 text-sm text-black font-bold leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-quat min-h-[120px]"
              />
            </div>
          </div>
        </div>
      </main >

      {/* Right Panel - Analysis */}
      <aside className="w-80 border-l-[3px] border-black flex flex-col shrink-0 bg-slate-50">
        <div className="p-6 border-b-[3px] border-black bg-white">
          <div className="flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-black" />
            <h2 className="text-xl font-black text-black uppercase tracking-tight">AI Live Analysis</h2>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-8">
          {/* Probe Suggestion */}
          <div className="space-y-3">
            <span className="text-sm font-black text-black uppercase tracking-widest opacity-60">Suggested Probes</span>
            {probingQuestions.length > 0 ? (
              <div className="space-y-3">
                {probingQuestions.map((q, i) => (
                  <div key={i} className="bg-white border-[3px] border-black p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] space-y-2">
                    <p className="text-base font-bold text-black italic leading-relaxed">"{q}"</p>
                    <div className="flex items-center gap-2 text-[10px] text-black font-black bg-quat border-2 border-black w-fit px-2 py-1 uppercase scale-90 -ml-1">
                      <Zap className="w-3 h-3 fill-current" /> Option {i + 1}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-5 border-[3px] border-dashed border-black bg-white/50 text-[11px] text-black font-bold text-center italic opacity-40">
                Awaiting more detail to generate probes
              </div>
            )}
          </div>

          {/* STAR Fields */}
          <div className="space-y-4">
            <span className="text-sm font-black text-black uppercase tracking-widest opacity-60">STAR Evidence Tracker</span>

            <div className="grid gap-4">
              {[
                { label: 'Situation', key: 'situation', icon: 'S', color: 'bg-white' },
                { label: 'Task', key: 'task', icon: 'T', color: 'bg-white' },
                { label: 'Action', key: 'action', icon: 'A', color: 'bg-white' },
                { label: 'Result', key: 'result', icon: 'R', color: 'bg-white' },
              ].map((field) => {
                const val = currentResult.starEvidence?.[field.key as keyof typeof currentResult.starEvidence];
                return (
                  <div key={field.key} className={`p-4 border-[3px] border-black transition-all ${val ? field.color + ' shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]' : 'bg-slate-200/50 opacity-40 grayscale'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="w-8 h-8 bg-black text-white flex items-center justify-center text-sm font-black">{field.icon}</span>
                        <span className="text-sm font-black text-black uppercase tracking-tight">{field.label}</span>
                      </div>
                      {!val && <span className="text-xs font-black text-black bg-white px-2 border border-black">MISSING</span>}
                    </div>
                    <p className="text-base text-black font-bold leading-normal min-h-[2.5rem]">

                      {val || `No ${field.label.toLowerCase()} details extracted yet...`}
                    </p>
                  </div>
                );
              })}
            </div>

          </div>

          <div className="pt-6 border-t-[3px] border-black">
            <div className="flex items-center justify-between text-base font-black uppercase text-black">


              <span>Completeness</span>
              <span className={isParameterComplete ? 'text-main' : 'text-secondary'}>
                {isParameterComplete ? 'Ready to grade' : 'Needs detail'}
              </span>
            </div>
            <div className="w-full h-4 bg-white border-[3px] border-black mt-2 overflow-hidden shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
              <div className={`h-full transition-all duration-500 border-r-2 border-black ${isParameterComplete ? 'bg-main w-full' : 'bg-secondary w-1/3'}`}></div>
            </div>
          </div>
        </div>
      </aside >

      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />

      {/* Rating Guide Modal */}
      {
        showRatingGuide && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-[2px]">
            <div className="bg-white border-[4px] border-black shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
              <header className="p-8 border-b-[4px] border-black flex justify-between items-center bg-main">
                <div>
                  <h2 className="text-2xl font-black text-black uppercase tracking-tighter">Rating Anchors</h2>
                  <p className="text-[10px] font-black text-black uppercase tracking-widest opacity-70">{currentItem.parameter}</p>
                </div>
                <button onClick={() => setShowRatingGuide(false)} className="w-12 h-12 border-[3px] border-black bg-white hover:bg-tertiary flex items-center justify-center text-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all">
                  <X className="w-6 h-6 stroke-[3px]" />
                </button>
              </header>
              <div className="flex-1 overflow-y-auto p-8 space-y-6 bg-white">
                {[
                  { lv: 4, text: currentItem.level4, label: 'Superior', color: 'bg-main' },
                  { lv: 3, text: currentItem.level3, label: 'Proficient', color: 'bg-quat' },
                  { lv: 2, text: currentItem.level2, label: 'Developing', color: 'bg-secondary' },
                  { lv: 1, text: currentItem.level1, label: 'Ineffective', color: 'bg-tertiary' },
                ].map((level) => (
                  <div key={level.lv} className={`p-6 border-[3px] border-black flex gap-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] ${level.color}`}>
                    <div className="shrink-0 w-12 h-12 bg-black flex items-center justify-center text-xl font-black text-white border-2 border-black">{level.lv}</div>
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-widest opacity-80 mb-1 block">Level {level.lv} - {level.label}</span>
                      <p className="text-sm font-black italic border-t-2 border-black/20 pt-2 leading-relaxed">"{level.text}"</p>
                    </div>
                  </div>
                ))}
              </div>
              <footer className="p-6 border-t-[4px] border-black bg-slate-50 flex justify-end">
                <Button onClick={() => setShowRatingGuide(false)} variant="primary">Close Rubric</Button>
              </footer>
            </div>
          </div>
        )
      }
    </div >
  );
};
