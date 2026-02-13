
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { AppSettings, InterviewResult, RubricItem, InterviewContextType } from '../types';

const defaultSettings: AppSettings = {
  provider: 'openrouter',
  modelName: 'google/gemini-3-flash-preview',
  candidateName: '',
  transcriptionMode: 'batch',
  googleApiKey: (import.meta as any).env?.VITE_GEMINI_API_KEY || (import.meta as any).env?.GEMINI_API_KEY || '',
  openRouterApiKey: (import.meta as any).env?.VITE_OPENROUTER_API_KEY || (import.meta as any).env?.OPENROUTER_API_KEY || '',
};

const InterviewContext = createContext<InterviewContextType | undefined>(undefined);

export const useInterview = () => {
  const context = useContext(InterviewContext);
  if (!context) {
    throw new Error('useInterview must be used within an InterviewProvider');
  }
  return context;
};

export const InterviewProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem('bars_settings');
      if (saved) {
        return { ...defaultSettings, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.error("Failed to parse settings:", e);
    }
    return defaultSettings;
  });

  const [rubric, setRubric] = useState<RubricItem[]>(() => {
    try {
      const saved = localStorage.getItem('bars_rubric');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error("Failed to parse rubric:", e);
      return [];
    }
  });

  const [results, setResults] = useState<Record<string, InterviewResult>>(() => {
    try {
      const saved = localStorage.getItem('bars_results');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      console.error("Failed to parse results:", e);
      return {};
    }
  });

  const [hasStarted, setHasStarted] = useState(() => {
    return localStorage.getItem('bars_hasStarted') === 'true';
  });
  const [isFinished, setIsFinished] = useState(() => {
    return localStorage.getItem('bars_isFinished') === 'true';
  });
  const [sessionId, setSessionId] = useState<string>(() => {
    return localStorage.getItem('bars_sessionId') || crypto.randomUUID();
  });

  const [fullRubric, setFullRubric] = useState<RubricItem[]>(() => {
    try {
      const saved = localStorage.getItem('bars_fullRubric');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error("Failed to parse fullRubric:", e);
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem('bars_settings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem('bars_rubric', JSON.stringify(rubric));
  }, [rubric]);

  useEffect(() => {
    localStorage.setItem('bars_fullRubric', JSON.stringify(fullRubric));
  }, [fullRubric]);

  useEffect(() => {
    localStorage.setItem('bars_results', JSON.stringify(results));
  }, [results]);

  useEffect(() => {
    localStorage.setItem('bars_hasStarted', String(hasStarted));
  }, [hasStarted]);

  useEffect(() => {
    localStorage.setItem('bars_isFinished', String(isFinished));
  }, [isFinished]);

  useEffect(() => {
    localStorage.setItem('bars_sessionId', sessionId);
  }, [sessionId]);

  const updateSettings = (newSettings: Partial<AppSettings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
  };

  const updateResult = (id: string, resultUpdate: Partial<InterviewResult>) => {
    setResults(prev => ({
      ...prev,
      [id]: {
        ...(prev[id] || { transcript: '', rating: 0, isEdited: false }),
        ...resultUpdate
      }
    }));
  };

  const resetInterview = () => {
    localStorage.removeItem('bars_currentIndex');
    setResults({});
    setHasStarted(false);
    setIsFinished(false);
    setSessionId(crypto.randomUUID());
  };

  return (
    <InterviewContext.Provider value={{
      settings,
      updateSettings,
      rubric,
      setRubric,
      fullRubric,
      setFullRubric,
      results,
      updateResult,
      hasStarted,
      setHasStarted,
      isFinished,
      setIsFinished,
      resetInterview,
      sessionId
    }}>
      {children}
    </InterviewContext.Provider>
  );
};
