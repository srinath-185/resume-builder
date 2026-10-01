/** Converts between the API's ResumeDocument and a flat form (lists as newline/comma text). */

const lines = text =>
  (text ?? '')
    .split('\n')
    .map(line => line.replace(/^\s*[-•*]\s*/, '').trim())
    .filter(Boolean);

const commas = text =>
  (text ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

const opt = value => {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed : undefined;
};

export function toResumeForm(document) {
  const doc = document ?? {};
  return {
    contact: { ...{ name: '', email: '', phone: '', location: '' }, ...doc.contact, links: (doc.contact?.links ?? []).join('\n') },
    headline: doc.headline ?? '',
    summary: doc.summary ?? '',
    experience: (doc.experience ?? []).map(role => ({ ...role, location: role.location ?? '', startDate: role.startDate ?? '', endDate: role.endDate ?? '', bullets: (role.bullets ?? []).join('\n') })),
    education: (doc.education ?? []).map(entry => ({ institution: entry.institution, degree: entry.degree ?? '', field: entry.field ?? '', startDate: entry.startDate ?? '', endDate: entry.endDate ?? '' })),
    skills: (doc.skills ?? []).join(', '),
    projects: (doc.projects ?? []).map(project => ({ name: project.name, description: project.description ?? '', bullets: (project.bullets ?? []).join('\n') })),
    certifications: (doc.certifications ?? []).map(cert => ({ name: cert.name, issuer: cert.issuer ?? '', date: cert.date ?? '' })),
  };
}

export function fromResumeForm(values) {
  return {
    contact: {
      name: values.contact.name.trim(),
      email: opt(values.contact.email),
      phone: opt(values.contact.phone),
      location: opt(values.contact.location),
      links: lines(values.contact.links),
    },
    headline: opt(values.headline),
    summary: opt(values.summary),
    experience: values.experience
      .filter(role => role.company.trim() || role.title.trim())
      .map(role => ({
        company: role.company.trim(),
        title: role.title.trim(),
        location: opt(role.location),
        startDate: opt(role.startDate),
        endDate: opt(role.endDate),
        bullets: lines(role.bullets),
      })),
    education: values.education
      .filter(entry => entry.institution.trim())
      .map(entry => ({ institution: entry.institution.trim(), degree: opt(entry.degree), field: opt(entry.field), startDate: opt(entry.startDate), endDate: opt(entry.endDate) })),
    skills: commas(values.skills),
    projects: values.projects.filter(project => project.name.trim()).map(project => ({ name: project.name.trim(), description: opt(project.description), bullets: lines(project.bullets) })),
    certifications: values.certifications.filter(cert => cert.name.trim()).map(cert => ({ name: cert.name.trim(), issuer: opt(cert.issuer), date: opt(cert.date) })),
  };
}
