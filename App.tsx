import React from 'react';
import { useInterview } from './context/InterviewContext';
import { Settings } from './components/Settings';
import { InterviewConsole } from './components/InterviewConsole';
import { SummaryScreen } from './components/SummaryScreen';
import { PasscodeScreen } from './components/PasscodeScreen';

const App: React.FC = () => {
  const { settings, updateSettings, hasStarted, isFinished } = useInterview();

  const handleAuthenticated = (keys: { openRouterApiKey: string; sarvamApiKey: string }) => {
    updateSettings({
      openRouterApiKey: keys.openRouterApiKey,
      sarvamApiKey: keys.sarvamApiKey,
      provider: 'openrouter',
      modelName: 'google/gemini-3-flash-preview',
      isAuthenticated: true,
    });
  };

  const handleManualMode = () => {
    updateSettings({ isAuthenticated: true });
  };

  if (isFinished) return <SummaryScreen />;
  if (hasStarted) return <InterviewConsole />;
  if (!settings.isAuthenticated) {
    return <PasscodeScreen onAuthenticated={handleAuthenticated} onManualMode={handleManualMode} />;
  }

  return <Settings />;
};

export default App;
