export const DOCUMENT = {
  contact: { name: 'Priya Raman', email: 'priya@example.test', phone: '+91 98765 43210', location: 'Chennai', links: ['https://linkedin.com/in/priya'] },
  headline: 'Senior Backend Engineer',
  summary: 'Builds payment services.',
  experience: [
    { company: 'Acme Payments', title: 'Senior Software Engineer', startDate: '2021-03', endDate: 'Present', bullets: ['Led the settlement migration', 'Designed payout APIs'] },
  ],
  education: [{ institution: 'Anna University', degree: 'B.E.', field: 'Computer Science', endDate: '2018' }],
  skills: ['Node.js', 'TypeScript', 'Kafka'],
  projects: [],
  certifications: [],
};

export const RESUME = {
  id: 'r1',
  fileName: 'priya.pdf',
  mimeType: 'application/pdf',
  size: 1000,
  isPrimary: true,
  parseStatus: 'PARSED',
  userEdited: false,
  document: DOCUMENT,
  parsedBy: { provider: 'groq', model: 'llama-3.3-70b-versatile' },
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
};

export const PROFILE = {
  id: 'p1',
  targetTitles: ['Senior Software Engineer'],
  skills: ['Node.js', 'Kafka'],
  yearsExperience: 8,
  location: 'Chennai',
  remoteOnly: false,
  autoTailorThreshold: 75,
  dailyCaps: { tailor: 10, apply: 15, outreach: 10 },
  defaultTemplateId: 'classic',
  autoApplyOnApprove: false,
};

export const TEMPLATES = [
  { id: 'classic', name: 'Classic', description: 'Safe default' },
  { id: 'modern', name: 'Modern', description: 'Blue accent' },
];
