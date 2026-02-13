
import React, { useState, useMemo, useEffect } from 'react';
import Papa from 'papaparse';
import {
  Upload, Download, Play, FileText, Check,
  ChevronDown, ChevronRight, Settings2, Users,
  Briefcase, Key, ExternalLink, AlertTriangle, Globe, Zap, Trash2, Database
} from 'lucide-react';
import { clearAllBackups, getStorageStats } from '../utils/indexedDb';
import { useInterview } from '../context/InterviewContext';
import { Button } from './Button';
import { RubricItem } from '../types';

export const Settings: React.FC = () => {
  const { settings, updateSettings, rubric, setRubric, setHasStarted } = useInterview();
  const [error, setError] = useState<string | null>(null);
  const [isApiKeyConnected, setIsApiKeyConnected] = useState<boolean>(false);

  const [rawRubric, setRawRubric] = useState<RubricItem[]>(rubric);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(rubric.map(r => r.id)));
  const [expandedCompetencies, setExpandedCompetencies] = useState<Record<string, boolean>>({});
  const [storageStats, setStorageStats] = useState<{ count: number; sizeBytes: number } | null>(null);

  useEffect(() => {
    loadStorageStats();
  }, []);

  const loadStorageStats = async () => {
    const stats = await getStorageStats();
    setStorageStats(stats);
  };

  const handleClearStorage = async () => {
    if (window.confirm("Are you sure you want to delete all audio backups? This cannot be undone.")) {
      await clearAllBackups();
      await loadStorageStats();
    }
  };

  useEffect(() => {
    const checkKey = async () => {
      // @ts-ignore - aistudio is provided by the environment
      if (window.aistudio && settings.provider === 'google') {
        // @ts-ignore
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setIsApiKeyConnected(hasKey);
      } else if (settings.provider === 'google') {
        setIsApiKeyConnected(!!settings.googleApiKey && settings.googleApiKey.length > 5);
      } else if (settings.provider === 'openrouter') {
        setIsApiKeyConnected(!!settings.openRouterApiKey && settings.openRouterApiKey.length > 5);
      }
    };
    checkKey();
    const interval = setInterval(checkKey, 2000);
    return () => clearInterval(interval);
  }, [settings.provider, settings.openRouterApiKey]);

  const handleConnectKey = async () => {
    // @ts-ignore
    if (window.aistudio && settings.provider === 'google') {
      // @ts-ignore
      await window.aistudio.openSelectKey();
      setIsApiKeyConnected(true);
    }
  };

  const groupedRubric = useMemo(() => {
    const groups: Record<string, RubricItem[]> = {};
    rawRubric.forEach(item => {
      if (!groups[item.competency]) groups[item.competency] = [];
      groups[item.competency].push(item);
    });
    return groups;
  }, [rawRubric]);

  const toggleCompetencySelection = (comp: string, select: boolean) => {
    const items = groupedRubric[comp] || [];
    const newSelected = new Set(selectedIds);
    items.forEach(item => {
      if (select) newSelected.add(item.id);
      else newSelected.delete(item.id);
    });
    setSelectedIds(newSelected);
  };

  const toggleParameterSelection = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) newSelected.delete(id);
    else newSelected.add(id);
    setSelectedIds(newSelected);
  };

  const handleDownloadTemplate = () => {
    const csvContent = "Competency,Parameter,Level_1_Anchor,Level_2_Anchor,Level_3_Anchor,Level_4_Anchor,Question\nGeneral Skills,Communication,Mumbles or unclear,Speaks clearly but unstructured,Structured and clear,Exceptional clarity and persuasion,Describe a time you explained a complex topic.\nLeadership,Conflict Resolution,Avoids conflict,Addresses conflict poorly,Mediates effectively,Turns conflict into opportunity,Tell me about a time you managed a team conflict.";
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'rubric_template.csv';
    link.click();
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const requiredHeaders = ['Competency', 'Parameter', 'Level_1_Anchor', 'Level_2_Anchor', 'Level_3_Anchor', 'Level_4_Anchor', 'Question'];
        const headers = results.meta.fields || [];
        const missing = requiredHeaders.filter(h => !headers.includes(h));

        if (missing.length > 0) {
          setError(`Invalid CSV. Missing headers: ${missing.join(', ')}`);
          return;
        }

        const parsedRubric: RubricItem[] = results.data.map((row: any, index: number) => ({
          id: `param_${index}_${Date.now()}`,
          competency: row['Competency'] || 'General',
          parameter: row['Parameter'],
          question: row['Question'],
          level1: row['Level_1_Anchor'],
          level2: row['Level_2_Anchor'],
          level3: row['Level_3_Anchor'],
          level4: row['Level_4_Anchor'],
        }));

        parsedRubric.sort((a, b) => {
          const compDiff = a.competency.localeCompare(b.competency);
          if (compDiff !== 0) return compDiff;
          return a.parameter.localeCompare(b.parameter);
        });

        setRawRubric(parsedRubric);
        setSelectedIds(new Set(parsedRubric.map(r => r.id)));
        const allComps = Array.from(new Set(parsedRubric.map(r => r.competency)));
        const newExpanded: Record<string, boolean> = {};
        allComps.forEach(c => newExpanded[c] = true);
        setExpandedCompetencies(newExpanded);
        setError(null);
      }
    });
  };

  const handleStartInterview = () => {
    const finalRubric = rawRubric.filter(item => selectedIds.has(item.id));
    setRubric(finalRubric);
    setHasStarted(true);
  };

  const isFormValid = settings.candidateName && selectedIds.size > 0 && isApiKeyConnected;

  return (
    <div className="min-h-screen py-16 px-6">
      <div className="max-w-3xl mx-auto space-y-12">
        <div className="space-y-4 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-secondary border-[3px] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] mb-4">
            <Briefcase className="w-8 h-8 text-black" />
          </div>
          <h1 className="text-5xl font-black text-black uppercase tracking-tighter">Setup Interview</h1>
          <p className="text-black font-bold max-w-lg mx-auto text-sm leading-relaxed bg-white border-[3px] border-black p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            Configure candidate details, choose your AI provider, and select the specific competencies for this behavioral assessment.
          </p>
        </div>


        <div className="space-y-8">
          {/* Step 1: Provider & API Configuration */}
          <section className="bg-white border-[3px] border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
            <div className="px-6 py-4 border-b-[3px] border-black flex items-center justify-between bg-secondary">
              <span className="text-xs font-black text-black uppercase tracking-widest">1. AI Provider</span>
              {isApiKeyConnected ? (
                <div className="flex items-center gap-1.5 text-black bg-main border-2 border-black px-3 py-1 text-[10px] font-black">
                  <Check className="w-3 h-3" /> CONNECTED
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-black bg-tertiary border-2 border-black px-3 py-1 text-[10px] font-black">
                  <AlertTriangle className="w-3 h-3" /> DISCONNECTED
                </div>
              )}
            </div>
            <div className="p-6 space-y-6">

              {/* Provider Selector */}
              <div className="grid grid-cols-2 gap-6">
                <button
                  onClick={() => settings.provider !== 'google' && updateSettings({ provider: 'google', modelName: 'gemini-2.5-flash' })}
                  className={`p-6 border-[3px] border-black text-left transition-all ${settings.provider === 'google'
                    ? 'bg-main translate-x-[-4px] translate-y-[-4px] shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]'
                    : 'bg-white hover:bg-slate-50'
                    }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className={`w-5 h-5 text-black shadow-none`} />
                    <span className={`text-sm font-black uppercase tracking-tight text-black`}>Google Gemini</span>
                  </div>
                  <p className="text-xs text-black font-bold leading-relaxed">Native integration with Google's latest models.</p>
                </button>

                <button
                  onClick={() => updateSettings({ provider: 'openrouter', modelName: 'google/gemini-3-flash-preview' })}
                  className={`p-6 border-[3px] border-black text-left transition-all ${settings.provider === 'openrouter'
                    ? 'bg-main translate-x-[-4px] translate-y-[-4px] shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]'
                    : 'bg-white hover:bg-slate-50'
                    }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Globe className={`w-5 h-5 text-black`} />
                    <span className={`text-sm font-black uppercase tracking-tight text-black`}>OpenRouter</span>
                  </div>
                  <p className="text-xs text-black font-bold leading-relaxed">Access 400+ models (OpenAI, Anthropic, etc).</p>
                </button>
              </div>

              {/* Dynamic Connection Inputs */}
              {settings.provider === 'google' ? (
                <div className="space-y-4 pt-6 border-t-[3px] border-black">
                  {/* @ts-ignore */}
                  {window.aistudio ? (
                    <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
                      <div className="flex-1 space-y-2">
                        <h3 className="text-sm font-black text-black uppercase tracking-tight flex items-center gap-2">
                          <Key className="w-4 h-4 text-black" /> Google API Key
                        </h3>
                        <p className="text-xs text-black font-bold leading-relaxed">
                          Using the API key selected in Google AI Studio.
                        </p>
                      </div>
                      <Button
                        variant={isApiKeyConnected ? "outline" : "primary"}
                        size="md"
                        onClick={handleConnectKey}
                        className="w-full md:w-auto shrink-0"
                      >
                        {isApiKeyConnected ? "Change API Key" : "Connect API Key"}
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-sm font-black text-black uppercase tracking-tight flex items-center gap-2">
                          <Key className="w-4 h-4 text-black" /> Google API Key
                        </label>
                        <p className="text-xs text-black font-bold">
                          Enter your Gemini API key from <a href="https://aistudio.google.com/app/apikey" target="_blank" className="text-blue-600 underline decoration-2">Google AI Studio</a>.
                        </p>
                      </div>
                      <input
                        type="password"
                        value={settings.googleApiKey}
                        onChange={(e) => updateSettings({ googleApiKey: e.target.value })}
                        placeholder="AIza..."
                        className="neo-brutalism-input text-sm"
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4 pt-6 border-t-[3px] border-black">
                  <div className="space-y-2">
                    <label className="text-sm font-black text-black uppercase tracking-tight flex items-center gap-2">
                      <Key className="w-4 h-4 text-black" /> OpenRouter API Key
                    </label>
                    <p className="text-xs text-black font-bold">
                      Get your key from <a href="https://openrouter.ai/keys" target="_blank" className="text-purple-600 underline decoration-2">openrouter.ai/keys</a>.
                    </p>
                  </div>
                  <div className="relative">
                    <input
                      type="password"
                      value={settings.openRouterApiKey}
                      onChange={(e) => updateSettings({ openRouterApiKey: e.target.value })}
                      placeholder="sk-or-..."
                      className="neo-brutalism-input text-sm"
                    />
                  </div>
                  {settings.provider === 'openrouter' && (
                    <p className="text-[10px] text-black font-bold bg-secondary p-3 border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                      <span className="font-black">Note:</span> You must choose a model that supports audio/image inputs (e.g., <code>google/gemini-3-flash-preview</code>).
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>


          {/* Step 2: Session Details */}
          <section className="bg-white border-[3px] border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
            <div className="px-6 py-4 border-b-[3px] border-black flex items-center gap-3 bg-secondary">
              <span className="text-xs font-black text-black uppercase tracking-widest">2. Session Setup</span>
            </div>
            <div className="p-6 grid gap-6 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-black text-black uppercase tracking-tight">Candidate name</label>
                <div className="relative">
                  <Users className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-black z-10" />
                  <input
                    type="text"
                    value={settings.candidateName}
                    onChange={(e) => updateSettings({ candidateName: e.target.value })}
                    className="neo-brutalism-input pl-12 text-sm"
                    placeholder="e.g. Jane Smith"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-black text-black uppercase tracking-tight">Model Name</label>
                <div className="relative">
                  <Settings2 className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-black z-10" />
                  <input
                    type="text"
                    value={settings.modelName}
                    onChange={(e) => updateSettings({ modelName: e.target.value })}
                    className="neo-brutalism-input pl-12 text-sm"
                    placeholder={settings.provider === 'google' ? "gemini-2.5-flash" : "google/gemini-3-flash-preview"}
                  />
                </div>
              </div>
            </div>
          </section>


          {/* Step 3: Rubric Setup */}
          <section className="bg-white border-[3px] border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
            <div className="px-6 py-4 border-b-[3px] border-black flex items-center justify-between bg-secondary">
              <span className="text-xs font-black text-black uppercase tracking-widest">3. Select Parameters</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleDownloadTemplate} className="bg-white h-8 px-2 text-[10px]">
                  <Download className="w-3.5 h-3.5 mr-1" /> Template
                </Button>
                <label className="cursor-pointer">
                  <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
                  <Button variant="outline" size="sm" className="pointer-events-none bg-white h-8 px-2 text-[10px]">
                    <Upload className="w-3.5 h-3.5 mr-1" /> Upload CSV
                  </Button>
                </label>
              </div>
            </div>

            <div className="p-6">
              {error && <div className="mb-6 p-4 bg-tertiary text-black text-xs font-bold border-[3px] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">{error}</div>}

              {rawRubric.length === 0 ? (
                <div className="text-center py-16 border-[3px] border-dashed border-black bg-slate-50">
                  <FileText className="w-12 h-12 text-black mx-auto mb-4" />
                  <p className="text-sm font-black uppercase text-black">Upload a rubric CSV to begin</p>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex justify-between items-center text-xs font-black uppercase text-black mb-4">
                    <span className="bg-main px-2 py-1 border-2 border-black">{selectedIds.size} parameters selected</span>
                  </div>

                  <div className="border-[3px] border-black divide-y-[3px] divide-black overflow-hidden">
                    {Object.entries(groupedRubric).map(([competency, items]) => {
                      const typedItems = items as RubricItem[];
                      const isExpanded = expandedCompetencies[competency];
                      const selectedCount = typedItems.filter(i => selectedIds.has(i.id)).length;
                      const allSelected = selectedCount === typedItems.length;
                      const someSelected = selectedCount > 0 && !allSelected;

                      return (
                        <div key={competency} className="bg-white">
                          <div
                            className="flex items-center px-4 py-4 bg-slate-50/50 hover:bg-secondary cursor-pointer transition-colors border-b-[3px] border-black last:border-b-0"
                            onClick={() => setExpandedCompetencies(prev => ({ ...prev, [competency]: !prev[competency] }))}
                          >
                            <span className="mr-3 text-black">{isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}</span>
                            <div className="flex items-center gap-3 flex-1" onClick={(e) => { e.stopPropagation(); toggleCompetencySelection(competency, !allSelected); }}>
                              <div className={`w-6 h-6 border-[3px] border-black flex items-center justify-center transition-colors ${allSelected ? 'bg-main' : someSelected ? 'bg-quat' : 'bg-white'}`}>
                                {allSelected && <Check className="w-4 h-4 text-black stroke-[4px]" />}
                                {someSelected && <div className="w-3 h-1 bg-black" />}
                              </div>
                              <span className="text-sm font-black uppercase tracking-tight text-black">{competency}</span>
                              <span className="text-[10px] font-black text-black ml-auto bg-white border-2 border-black px-2 py-0.5">{typedItems.length}</span>
                            </div>
                          </div>
                          {isExpanded && (
                            <div className="bg-white divide-y-2 divide-black border-b-[3px] border-black">
                              {typedItems.map(item => (
                                <div
                                  key={item.id}
                                  className={`flex items-start gap-4 px-12 py-4 cursor-pointer transition-colors hover:bg-secondary/20 ${selectedIds.has(item.id) ? 'bg-main/20' : ''}`}
                                  onClick={() => toggleParameterSelection(item.id)}
                                >
                                  <div className={`mt-0.5 w-5 h-5 border-2 border-black flex items-center justify-center transition-colors ${selectedIds.has(item.id) ? 'bg-main' : 'bg-white'}`}>
                                    {selectedIds.has(item.id) && <Check className="w-4 h-4 text-black stroke-[3px]" />}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm text-black font-black uppercase tracking-tight truncate">{item.parameter}</p>
                                    <p className="text-xs text-black font-bold truncate mt-1 opacity-70">{item.question}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                </div>
              )}
            </div>
          </section>

          {/* Step 4: Storage Management */}
          <section className="bg-white border-[3px] border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
            <div className="px-6 py-4 border-b-[3px] border-black flex items-center gap-3 bg-white">
              <span className="text-xs font-black text-black uppercase tracking-widest">4. Storage Management</span>
            </div>
            <div className="p-6 flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-black" />
                  <span className="text-sm font-black text-black uppercase">Audio Backups</span>
                </div>
                <p className="text-xs text-black font-bold opacity-60">
                  {storageStats
                    ? `${storageStats.count} files • ${(storageStats.sizeBytes / 1024 / 1024).toFixed(2)} MB used`
                    : 'Checking storage...'}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearStorage}
                className="bg-tertiary hover:bg-tertiary"
                disabled={!storageStats || storageStats.count === 0}
              >
                <Trash2 className="w-4 h-4 mr-2" /> Clear Backups
              </Button>
            </div>
          </section>


          <div className="pt-8 flex flex-col items-center gap-6">
            {!isApiKeyConnected && (
              <p className="text-xs text-black font-black uppercase bg-tertiary px-3 py-1 border-2 border-black">Please connect your {settings.provider === 'google' ? 'Google' : 'OpenRouter'} API key to continue</p>
            )}
            <Button size="lg" disabled={!isFormValid} onClick={handleStartInterview} className="w-full max-sm:max-w-none max-w-sm h-16 text-lg">
              Launch Interview <Play className="w-6 h-6 ml-3 fill-current" />
            </Button>
          </div>

        </div>
      </div>
    </div>
  );
};
