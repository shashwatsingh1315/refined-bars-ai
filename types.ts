
export interface RubricItem {
  id: string;
  competency: string;
  parameter: string;
  question: string;
  level1: string;
  level2: string;
  level3: string;
  level4: string;
}

export interface STARResult {
  situation: string;
  task: string;
  action: string;
  result: string;
}

export interface InterviewResult {
  transcript: string; // The full dialogue for this parameter
  starEvidence?: STARResult;
  rating: number;
  isEdited: boolean;
}

export type AIProvider = 'google' | 'openrouter';

export interface AppSettings {
  provider: AIProvider;
  modelName: string;
  candidateName: string;
  openRouterApiKey?: string;
  googleApiKey?: string;
}

export interface InterviewContextType {
  settings: AppSettings;
  updateSettings: (newSettings: Partial<AppSettings>) => void;
  rubric: RubricItem[];
  setRubric: (rubric: RubricItem[]) => void;
  results: Record<string, InterviewResult>;
  updateResult: (id: string, result: Partial<InterviewResult>) => void;
  hasStarted: boolean;
  setHasStarted: (started: boolean) => void;
  isFinished: boolean;
  setIsFinished: (finished: boolean) => void;
  resetInterview: () => void;
  sessionId: string;
}
