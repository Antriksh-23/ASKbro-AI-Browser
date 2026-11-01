import { z } from 'zod';

export const PreferredToneEnum = z.enum(['professional', 'casual', 'hinglish']);
export type PreferredTone = z.infer<typeof PreferredToneEnum>;

/**
 * Zod schema for runtime validation of UserProfile data
 */
export const UserProfileSchema = z.object({
  fullName: z.string().default(''),
  email: z.string().default(''),
  phone: z.string().default(''),
  collegeOrUniversity: z.string().default(''),
  major: z.string().default(''),
  graduationYear: z.string().default(''),
  portfolioUrl: z.string().optional().default(''),
  linkedinUrl: z.string().optional().default(''),
  githubUrl: z.string().optional().default(''),
  skills: z.array(z.string()).default([]),
  preferredTone: PreferredToneEnum.default('professional'),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;

export const DEFAULT_USER_PROFILE: UserProfile = {
  fullName: '',
  email: '',
  phone: '',
  collegeOrUniversity: '',
  major: '',
  graduationYear: '',
  portfolioUrl: '',
  linkedinUrl: '',
  githubUrl: '',
  skills: [],
  preferredTone: 'professional',
};

import { SkillDefinition } from './skills';
export type { SkillDefinition };
export * from './skills';
