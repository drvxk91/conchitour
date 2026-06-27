export const AI_THEMES = [
  'Tourism',
  'Architecture',
  'History',
  'Real estate sale',
  'Hotel marketing',
  'Restaurant',
  'Museum',
  'Sport venue',
  'Wedding venue',
  'Natural reserve',
  'Industrial',
  'Construction site',
  'Custom (use instructions)',
] as const;

export type AiTheme = (typeof AI_THEMES)[number];

export const AI_TONE_LABELS: Record<string, string> = {
  marketing:    'Marketing',
  factual:      'Factual',
  storytelling: 'Storytelling',
  poetic:       'Poetic',
  educational:  'Educational',
};

export const AI_AUDIENCE_LABELS: Record<string, string> = {
  general:      'General public',
  professional: 'Professionals',
  luxury:       'Luxury',
  youth:        'Youth',
  family:       'Families',
  senior:       'Seniors',
};

export const AI_LENGTH_LABELS: Record<string, string> = {
  short:  'Short — 1 sentence',
  medium: 'Medium — 2-3 sentences',
  long:   'Long — 4-5 sentences',
};
