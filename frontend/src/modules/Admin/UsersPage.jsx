import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { z } from 'zod';
import { useCreateAdminUserMutation, useListAdminUsersQuery, useRevokeUserSessionsMutation, useSetUserRoleMutation, useSetUserStatusMutation } from '@/app/api/admin';
import { selectRole, selectUser } from '@/app/authSlice';
import { DataTable } from '@/common/components/DataTable';
import { Badge, Button, ErrorMessage, Input, Modal, PageHeader, Select, Spinner } from '@/common/components/ui';
import { ModuleForm } from '@/common/crud/ModuleLoader';
import { Pager } from '@/common/components/Pager';

const PAGE_SIZE = 25;
const ROLES = ['user', 'admin', 'superadmin'];
const ROLE_TONE = { superadmin: 'red', admin: 'amber', user: 'gray' };

export const NEW_USER_FORM = {
  fields: [
    { name: 'name', label: 'Name' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'password', label: 'Temporary password', type: 'password', hint: 'Share it securely; admins need at least 12 characters.' },
  ],
  schema: z.object({
    name: z.string().trim().min(1, 'Enter a name').max(120),
    email: z.string().trim().email('Enter a valid email'),
    password: z.string().min(8, 'Use at least 8 characters').max(72, 'Use at most 72 characters'),
  }),
};

export default function UsersPage() {
  const { t } = useTranslation();
  const me = useSelector(selectUser);
  const myRole = useSelector(selectRole);
  const isSuperadmin = myRole === 'superadmin';
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);

  const params = { q: search.trim() || undefined, role: role || undefined, status: status || undefined, page, limit: PAGE_SIZE };
  const { data, isLoading, error } = useListAdminUsersQuery(params);
  const [createUser, createState] = useCreateAdminUserMutation();
  const [setUserStatus, statusState] = useSetUserStatusMutation();
  const [setUserRole, roleState] = useSetUserRoleMutation();
  const [revokeSessions, revokeState] = useRevokeUserSessionsMutation();

  // Mirrors the API's rules so buttons that would be refused are not offered.
  const canManage = user => user.id !== me?.id && (isSuperadmin || user.role === 'user');
  const filter = setter => event => {
    setter(event.target.value);
    setPage(1);
  };

  return (
    <div>
      <PageHeader
        title={t('admin.users.title', 'Users')}
        description={t('admin.users.description', 'Disable accounts, sign users out everywhere and manage roles. Every change is recorded in the audit log.')}
        actions={
          <Button icon={Plus} onClick={() => setAdding(true)}>
            {t('admin.users.add', 'Add user')}
          </Button>
        }
      />
      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <Input aria-label={t('admin.users.search', 'Search by name or email')} placeholder={t('admin.users.search', 'Search by name or email')} value={search} onChange={filter(setSearch)} />
        <Select aria-label={t('admin.users.role', 'Role')} value={role} onChange={filter(setRole)}>
          <option value="">{t('admin.users.anyRole', 'Any role')}</option>
          {ROLES.map(value => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
        <Select aria-label={t('admin.users.status', 'Status')} value={status} onChange={filter(setStatus)}>
          <option value="">{t('admin.users.anyStatus', 'Any status')}</option>
          <option value="active">active</option>
          <option value="disabled">disabled</option>
        </Select>
      </div>
      <div className="space-y-4">
        <ErrorMessage error={error ?? statusState.error ?? roleState.error ?? revokeState.error} />
        {revokeState.isSuccess && <p className="text-sm text-green-700">{t('admin.users.revoked', 'Signed out of every session.')}</p>}
        {isLoading ? (
          <Spinner />
        ) : (
          <DataTable
            rows={data?.items}
            empty={t('admin.users.empty', 'No users match.')}
            columns={[
              {
                key: 'name',
                header: t('admin.users.user', 'User'),
                render: user => (
                  <div>
                    <p className="font-medium text-slate-900">{user.name}</p>
                    <p className="text-xs text-slate-500">{user.email}</p>
                  </div>
                ),
              },
              {
                key: 'role',
                header: t('admin.users.role', 'Role'),
                render: user =>
                  isSuperadmin && canManage(user) ? (
                    <Select aria-label={t('admin.users.roleOf', 'Role of {{email}}', { email: user.email })} value={user.role} onChange={event => setUserRole({ id: user.id, role: event.target.value })}>
                      {ROLES.map(value => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Badge tone={ROLE_TONE[user.role]}>{user.role}</Badge>
                  ),
              },
              { key: 'status', header: t('admin.users.status', 'Status'), render: user => <Badge tone={user.status === 'active' ? 'green' : 'red'}>{user.status}</Badge> },
              { key: 'lastLoginAt', header: t('admin.users.lastLogin', 'Last sign-in'), render: user => (user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '—') },
              {
                key: 'actions',
                header: '',
                render: user =>
                  canManage(user) && (
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button variant="secondary" onClick={() => setUserStatus({ id: user.id, status: user.status === 'active' ? 'disabled' : 'active' })}>
                        {user.status === 'active' ? t('admin.users.disable', 'Disable') : t('admin.users.enable', 'Enable')}
                      </Button>
                      <Button variant="ghost" onClick={() => revokeSessions(user.id)}>
                        {t('admin.users.signOut', 'Sign out everywhere')}
                      </Button>
                    </div>
                  ),
              },
            ]}
          />
        )}
        {data && <Pager page={page} total={data.total} pageSize={PAGE_SIZE} onChange={setPage} />}
      </div>
      <Modal open={adding} title={t('admin.users.add', 'Add user')} onClose={() => setAdding(false)}>
        <ModuleForm
          config={NEW_USER_FORM}
          initial={{ name: '', email: '', password: '' }}
          submitting={createState.isLoading}
          error={createState.error}
          onCancel={() => setAdding(false)}
          onSubmit={async values => {
            const result = await createUser(values);
            if (!result.error) setAdding(false);
          }}
        />
      </Modal>
    </div>
  );
}
