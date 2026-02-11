
import React, { useState, useEffect } from 'react';
import { useInterview } from '../context/InterviewContext';
import { analyzeHolisticSTAR, generateMasterTranscript } from '../services/geminiService';
import { Button } from './Button';
import { SettingsModal } from './SettingsModal';
import { Settings2, Loader2, Download, AlertCircle, Sparkles, ScrollText, UserCircle, CheckCircle2, FileAudio } from 'lucide-react';
import { generatePDF } from '../utils/exportUtils';
import { STARResult } from '../types';
import { getSessionAudio } from '../utils/indexedDb';

export const SummaryScreen: React.FC = () => {
  const { rubric, settings, results, updateResult, resetInterview, sessionId } = useInterview();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const [masterTranscript, setMasterTranscript] = useState<string | null>(null);
  const [isGeneratingMaster, setIsGeneratingMaster] = useState(false);

  // ... (useEffect hook)

  const handleGenerateMasterTranscript = async () => {
    setIsGeneratingMaster(true);
    setError(null);
    try {
      if (!sessionId) throw new Error("No session ID found.");

      const audioBlobs = await getSessionAudio(sessionId);
      if (audioBlobs.length === 0) {
        throw new Error("No audio recordings found for this session.");
      }

      const audioData = audioBlobs.map(b => ({ blob: b.blob, mimeType: b.mimeType }));
      const transcript = await generateMasterTranscript(settings, audioData);
      setMasterTranscript(transcript);
    } catch (err: any) {
      console.error("Master Transcript Generation Failed:", err);
      setError(`AI generation failed (${err.message}). Switching to partial transcripts fallback.`);

      // Fallback: Concatenate existing transcripts from results
      const fallbackTranscript = rubric
        .map(item => {
          const t = results[item.id]?.transcript;
          return t ? `--- Question: ${item.parameter} ---\n${t}` : null;
        })
        .filter(Boolean)
        .join("\n\n");

      if (fallbackTranscript) {
        setMasterTranscript(fallbackTranscript);
      } else {
        setError("Failed to generate master transcript and no partial transcripts available.");
      }
    } finally {
      setIsGeneratingMaster(false);
    }
  };

  const handleHolisticAnalysis = async () => {
    setIsAnalyzing(true);
    setError(null);
    try {
      if (!masterTranscript) {
        throw new Error("Please generate a master transcript first.");
      }
      const newResults = await analyzeHolisticSTAR(settings, masterTranscript, rubric);

      // Batch update results
      Object.entries(newResults).forEach(([id, result]) => {
        updateResult(id, result);
      });
    } catch (err: any) {
      console.error("Holistic Analysis Failed:", err);
      setError(err.message || "Failed to complete holistic analysis.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDownloadReport = () => {
    generatePDF(settings, rubric, results);
  };

  return (
    <div className="min-h-screen py-20 px-6 bg-[#f0f0f0]">
      <div className="max-w-5xl mx-auto space-y-12">
        {/* Top Navigation / Header */}
        <header className="flex items-center justify-between pb-8 border-b-[4px] border-black">
          <div>
            <h1 className="text-4xl font-black text-black uppercase tracking-tight mb-2">Interview Summary</h1>
            <p className="text-base font-bold text-black opacity-60 uppercase tracking-widest">
              Candidate: {settings.candidateName}
            </p>
          </div>
          <div className="flex gap-4">
            <Button variant="outline" onClick={() => setShowSettings(true)} className="bg-white hover:bg-slate-100">
              <Settings2 className="w-5 h-5 mr-2" />
              Settings
            </Button>
            <Button
              onClick={handleDownloadReport}
              variant="outline"
              className="bg-white hover:bg-[#FFD600]"
            >
              <Download className="w-5 h-5 mr-2" />
              Download Report
            </Button>
            <Button
              onClick={resetInterview}
              variant="destructive"
            >
              <UserCircle className="w-5 h-5 mr-2" />
              New Interview
            </Button>
          </div>
        </header>

        {/* Global Actions */}
        <div className="grid md:grid-cols-2 gap-8">
          <div className="bg-[#A3E635] border-[4px] border-black p-8 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col justify-between">
            <div>
              <h3 className="text-xl font-black text-black uppercase mb-2">Holistic Analysis</h3>
              <p className="text-sm font-bold text-black mb-6 leading-relaxed">
                Have the AI read the full transcript to verify all STAR evidence and assign preliminary scores.
              </p>
            </div>
            <Button
              onClick={handleHolisticAnalysis}
              disabled={isAnalyzing || !masterTranscript}
              className="w-full bg-black text-white hover:bg-white hover:text-black justify-between group"
            >
              {isAnalyzing ? "Analyzing..." : "Run AI Analysis"}
              {isAnalyzing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5 group-hover:scale-110 transition-transform" />}
            </Button>
          </div>

          <div className="bg-[#00D1FF] border-[4px] border-black p-8 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col justify-between">
            <div>
              <h3 className="text-xl font-black text-black uppercase mb-2">Export Data</h3>
              <p className="text-sm font-bold text-black mb-6 leading-relaxed">
                Download a comprehensive PDF report including the transcript, scores, and evidence breakdown.
              </p>
            </div>
            <Button
              onClick={handleDownloadReport}
              className="w-full bg-black text-white hover:bg-white hover:text-black justify-between group"
            >
              Download PDF
              <Download className="w-5 h-5 group-hover:translate-y-1 transition-transform" />
            </Button>
          </div>
        </div>

        {/* Master Transcript Section */}
        <div className="bg-white border-[4px] border-black shadow-[10px_10px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
          <div className="px-10 py-6 border-b-[4px] border-black flex items-center justify-between bg-[#FFD600]">
            <div className="flex items-center gap-3">
              <FileAudio className="w-6 h-6 text-black" />
              <h2 className="text-xl font-black text-black uppercase tracking-tight">Full Session Transcript</h2>
            </div>
            {!masterTranscript && (
              <Button
                onClick={handleGenerateMasterTranscript}
                disabled={isGeneratingMaster}
                variant="primary"
                size="sm"
                className="bg-black text-white"
              >
                {isGeneratingMaster ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
                {isGeneratingMaster ? "Processing Audio..." : "Generate Master Transcript"}
              </Button>
            )}
          </div>

          {error && (
            <div className="bg-[#FF6B6B] border-b-[4px] border-black px-10 py-3 flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-black" />
              <p className="text-xs font-black uppercase text-black">{error}</p>
            </div>
          )}

          <div className="p-10">
            {masterTranscript ? (
              <div className="bg-slate-50 border-[3px] border-black p-6 font-mono text-sm leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto">
                {masterTranscript}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center opacity-50">
                <p className="text-sm font-black uppercase text-black">
                  {isGeneratingMaster ? "Sending all session audio to Gemini for verbatim transcription..." : "Generate a complete chronological transcript of the entire interview."}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Detailed Assessment */}
        <h2 className="text-xl font-black text-black uppercase tracking-tighter px-2">Detailed Assessment</h2>

        <div className="grid gap-12">
          {rubric.map((item) => {
            const result = results[item.id];
            const star = result?.starEvidence;

            return (
              <div key={item.id} className="bg-white border-[4px] border-black shadow-[10px_10px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
                <div className="px-10 py-6 border-b-[4px] border-black flex justify-between items-center bg-[#00D1FF]">
                  <div>
                    <span className="text-[10px] font-black text-black uppercase tracking-widest opacity-60">{item.competency}</span>
                    <h3 className="text-2xl font-black text-black uppercase tracking-tight">{item.parameter}</h3>
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="text-xs font-black text-black uppercase tracking-widest">Score</label>
                    <select
                      value={result?.rating || 0}
                      onChange={(e) => updateResult(item.id, { rating: parseInt(e.target.value), isEdited: true })}
                      className={`w-16 h-16 border-[4px] border-black font-black text-2xl text-center appearance-none cursor-pointer transition-all ${result?.rating ? 'bg-[#A3E635] text-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]' : 'bg-white text-black'
                        }`}
                    >
                      <option value="0">-</option>
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                      <option value="4">4</option>
                    </select>
                  </div>
                </div>

                <div className="p-10 grid md:grid-cols-2 gap-12">
                  {/* STAR Evidence */}
                  <div className="space-y-6">
                    <div className="flex items-center gap-3 px-2 py-1 border-2 border-black bg-[#FFD600] w-fit shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                      <ScrollText className="w-4 h-4 text-black" />
                      <h4 className="text-[11px] font-black text-black uppercase tracking-widest">STAR Breakdown</h4>
                    </div>
                    {star ? (
                      <div className="grid gap-4">
                        {[
                          { label: 'Situation', val: star.situation, color: 'bg-white border-black' },
                          { label: 'Task', val: star.task, color: 'bg-white border-black' },
                          { label: 'Action', val: star.action, color: 'bg-white border-black' },
                          { label: 'Result', val: star.result, color: 'bg-white border-black' },
                        ].map(s => (
                          <div key={s.label} className={`p-4 border-[3px] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,0.15)] ${s.color}`}>
                            <span className="text-[10px] font-black uppercase text-black italic tracking-wider block mb-1">{s.label}</span>
                            <p className="text-xs text-black font-bold leading-relaxed">{s.val || 'Evidence missing.'}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-12 border-[3px] border-dashed border-black bg-slate-50 text-center">
                        <p className="text-xs font-black uppercase text-black opacity-30 italic">No evidence synthesized for this parameter.</p>
                      </div>
                    )}
                  </div>

                  {/* Rubric anchors */}
                  <div className="space-y-6">
                    <h4 className="text-[11px] font-black text-black uppercase tracking-widest px-2 py-1 border-2 border-black bg-[#00D1FF] w-fit shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">Rating Reference</h4>
                    <div className="grid gap-3">
                      {[
                        { lv: 1, text: item.level1, c: 'bg-[#FF6B6B]' },
                        { lv: 2, text: item.level2, c: 'bg-[#FFD600]' },
                        { lv: 3, text: item.level3, c: 'bg-[#00D1FF]' },
                        { lv: 4, text: item.level4, c: 'bg-[#A3E635]' },
                      ].map(a => (
                        <div key={a.lv} className={`p-4 border-[3px] border-black text-[11px] flex gap-4 transition-all ${result?.rating === a.lv ? 'shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] translate-x-[-2px] translate-y-[-2px] ring-2 ring-black' : 'opacity-30 grayscale'} ${a.c}`}>
                          <div className="font-black shrink-0 w-8 h-8 flex items-center justify-center bg-black text-white border-2 border-black">{a.lv}</div>
                          <div className="pt-1 font-black italic leading-tight">"{a.text}"</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
