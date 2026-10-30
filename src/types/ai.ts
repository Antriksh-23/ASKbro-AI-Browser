export type AIProvider = 'gemini' | 'groq';

export type OutputLanguage = 'en' | 'hinglish';

export interface AISettings {
  geminiApiKey: string;
  groqApiKey?: string;
  language: OutputLanguage;
  model: string;
}

export interface SummaryResult {
  tldr: string;
  keyTakeaways: string[];
  actionableSteps: string[];
}
