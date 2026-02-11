import React from 'react';
import { useInterview } from './context/InterviewContext';
import { Settings } from './components/Settings';
import { InterviewConsole } from './components/InterviewConsole';
import { SummaryScreen } from './components/SummaryScreen';

const App: React.FC = () => {
  const { hasStarted, isFinished } = useInterview();

  if (isFinished) return <SummaryScreen />;
  if (hasStarted) return <InterviewConsole />;
  
  return <Settings />;
};

export default App;
