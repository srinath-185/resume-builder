import { zodResolver } from '@hookform/resolvers/zod';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { DataTable } from '../components/DataTable';
import { Button, ErrorMessage, Field, Input, Modal, PageHeader, Spinner, TextArea } from '../components/ui';

function FieldControl({ field, register }) {
  const props = { id: field.name, ...register(field.name, field.type === 'number' ? { valueAsNumber: true } : undefined), placeholder: field.placeholder };
  if (field.type === 'textarea') return <TextArea rows={field.rows ?? 6} {...props} />;
  if (field.type === 'checkbox') return <input type="checkbox" className="size-4 rounded border-slate-300" {...props} />;
  return <Input type={field.type ?? 'text'} {...props} />;
}

export function ModuleForm({ config, initial, onSubmit, onCancel, submitting, error }) {
  const { t } = useTranslation();
  const { register, handleSubmit, formState } = useForm({ resolver: config.schema ? zodResolver(config.schema) : undefined, defaultValues: initial });
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {config.fields.map(field => (
        <Field key={field.name} label={field.label} hint={field.hint} error={formState.errors[field.name]?.message} htmlFor={field.name}>
          <FieldControl field={field} register={register} />
        </Field>
      ))}
      <ErrorMessage error={error} />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button type="submit" loading={submitting}>
          {t('common.save', 'Save')}
        </Button>
      </div>
    </form>
  );
}

/**
 * A list-and-form feature declared as configuration (title, hooks, columns,
 * fields, zod schema). Use a hand-built screen only when the UI is genuinely
 * not list-and-form shaped.
 */
export function createModuleComponent(config) {
  return function ModuleComponent() {
    const { t } = useTranslation();
    const { data, isLoading, error } = config.useList();
    const [create, createState] = config.useCreate ? config.useCreate() : [undefined, {}];
    const [update, updateState] = config.useUpdate ? config.useUpdate() : [undefined, {}];
    const [remove, removeState] = config.useRemove ? config.useRemove() : [undefined, {}];
    const [editing, setEditing] = useState(null);
    const [deleting, setDeleting] = useState(null);

    const rows = config.select ? config.select(data) : data;
    const close = () => setEditing(null);
    const submit = async values => {
      const body = config.fromForm ? config.fromForm(values) : values;
      const result = editing?.id ? await update({ id: editing.id, ...body }) : await create(body);
      if (!result.error) close();
    };

    const actionsColumn = (update || remove || config.rowActions) && {
      key: '__actions',
      header: '',
      className: 'w-0 whitespace-nowrap text-right',
      render: row => (
        <div className="flex justify-end gap-1">
          {config.rowActions?.(row)}
          {update && (
            <Button variant="ghost" icon={Pencil} aria-label={t('common.edit', 'Edit')} onClick={() => setEditing(row)}>
              <span className="sr-only">{t('common.edit', 'Edit')}</span>
            </Button>
          )}
          {remove && (
            <Button variant="ghost" icon={Trash2} aria-label={t('common.delete', 'Delete')} onClick={() => setDeleting(row)}>
              <span className="sr-only">{t('common.delete', 'Delete')}</span>
            </Button>
          )}
        </div>
      ),
    };

    return (
      <div>
        <PageHeader
          title={config.title}
          description={config.description}
          actions={
            create && (
              <Button icon={Plus} onClick={() => setEditing({})}>
                {config.createLabel ?? t('common.new', 'New')}
              </Button>
            )
          }
        />
        {config.intro}
        <ErrorMessage error={error} />
        {isLoading ? <Spinner /> : <DataTable columns={[...config.columns, ...(actionsColumn ? [actionsColumn] : [])]} rows={rows} empty={config.emptyTitle} />}

        <Modal open={editing !== null} title={editing?.id ? config.editTitle ?? config.title : config.createLabel ?? config.title} onClose={close}>
          {editing !== null && (
            <ModuleForm
              config={config}
              initial={editing.id ? (config.toForm ? config.toForm(editing) : editing) : config.defaults ?? {}}
              onSubmit={submit}
              onCancel={close}
              submitting={createState.isLoading || updateState.isLoading}
              error={editing.id ? updateState.error : createState.error}
            />
          )}
        </Modal>

        <Modal
          open={deleting !== null}
          title={t('common.confirmDelete', 'Delete this item?')}
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeleting(null)}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button
                variant="danger"
                loading={removeState.isLoading}
                onClick={async () => {
                  const result = await remove(deleting.id);
                  if (!result.error) setDeleting(null);
                }}
              >
                {t('common.delete', 'Delete')}
              </Button>
            </>
          }
        >
          <ErrorMessage error={removeState.error} />
          <p className="text-sm text-slate-600">{config.deleteWarning ?? t('common.deleteWarning', 'This cannot be undone.')}</p>
        </Modal>
      </div>
    );
  };
}
