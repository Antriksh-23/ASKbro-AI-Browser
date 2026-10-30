export interface UserProfile {
  fullName: string;
  email: string;
  phone: string;
  collegeOrUniversity: string;
  major: string;
  graduationYear: string;
  portfolioUrl?: string;
  linkedinUrl?: string;
  githubUrl?: string;
  skills: string[];
  preferredTone: 'professional' | 'casual' | 'hinglish';
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  actionWorkflow?: string;
  isBuiltIn?: boolean;
}
