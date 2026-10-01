import { z } from 'zod';
import { useCreateContactMutation, useDeleteContactMutation, useListContactsQuery, useUpdateContactMutation } from '@/app/api/outreach';
import { Badge } from '@/common/components/ui';
import { createModuleComponent } from '@/common/crud/ModuleLoader';

const optional = z.string().max(160).optional();

/** A list-and-form feature, so it is declared rather than hand-built. */
export const CONTACTS_CONFIG = {
  title: 'Contacts',
  description: 'Recruiters and hiring managers you may email. “Do not contact” is permanent and checked before every send.',
  createLabel: 'Add contact',
  editTitle: 'Edit contact',
  emptyTitle: 'No contacts yet. They are added from hiring posts or by hand.',
  useList: useListContactsQuery,
  useCreate: useCreateContactMutation,
  useUpdate: useUpdateContactMutation,
  useRemove: useDeleteContactMutation,
  defaults: { email: '', name: '', company: '', doNotContact: false },
  columns: [
    { key: 'email', header: 'Email' },
    { key: 'name', header: 'Name' },
    { key: 'company', header: 'Company' },
    { key: 'source', header: 'Source', render: contact => <Badge>{contact.source.toLowerCase()}</Badge> },
    { key: 'doNotContact', header: '', render: contact => (contact.doNotContact ? <Badge tone="red">do not contact</Badge> : null) },
    { key: 'lastContactedAt', header: 'Last emailed', render: contact => (contact.lastContactedAt ? new Date(contact.lastContactedAt).toLocaleDateString() : '') },
  ],
  fields: [
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'name', label: 'Name' },
    { name: 'company', label: 'Company' },
    { name: 'doNotContact', label: 'Do not contact', type: 'checkbox' },
  ],
  schema: z.object({ email: z.string().trim().email('Enter a valid email'), name: optional, company: optional, doNotContact: z.boolean().optional() }),
  toForm: contact => ({ email: contact.email, name: contact.name ?? '', company: contact.company ?? '', doNotContact: contact.doNotContact }),
  /** Email is the identity of a contact; edits only change the rest. */
  fromForm: values => ({ email: values.email, name: values.name?.trim() || undefined, company: values.company?.trim() || undefined, doNotContact: values.doNotContact }),
};

const ContactsModule = createModuleComponent({
  ...CONTACTS_CONFIG,
  useUpdate: () => {
    const [update, state] = useUpdateContactMutation();
    return [({ id, name, company, doNotContact }) => update({ id, name: name ?? null, company: company ?? null, doNotContact: Boolean(doNotContact) }), state];
  },
  useCreate: () => {
    const [create, state] = useCreateContactMutation();
    return [({ email, name, company }) => create({ email, ...(name ? { name } : {}), ...(company ? { company } : {}) }), state];
  },
});

export default ContactsModule;
