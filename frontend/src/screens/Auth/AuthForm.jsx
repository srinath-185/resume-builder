import { zodResolver } from '@hookform/resolvers/zod';
import { FileText } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { signedIn } from '@/app/authSlice';
import { Button, ErrorMessage, Field, Input } from '@/common/components/ui';

/** Shared shell for login and registration: form, submit, store the session, go back where the user was. */
export function AuthForm({ title, schema, fields, mutation, submitLabel, footer }) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [submit, { isLoading, error }] = mutation();
  const { register, handleSubmit, formState } = useForm({ resolver: zodResolver(schema) });

  const onSubmit = async values => {
    const result = await submit(values);
    if (result.data) {
      dispatch(signedIn(result.data));
      const next = params.get('next');
      navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/', { replace: true });
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2 text-lg font-semibold">
          <FileText className="size-6 text-brand-600" aria-hidden />
          Resume Builder
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 rounded-lg bg-white p-6 shadow-sm ring-1 ring-slate-200" noValidate>
          <h1 className="text-base font-semibold">{title}</h1>
          {fields.map(field => (
            <Field key={field.name} label={field.label} error={formState.errors[field.name]?.message} htmlFor={field.name}>
              <Input id={field.name} type={field.type ?? 'text'} autoComplete={field.autoComplete} {...register(field.name)} />
            </Field>
          ))}
          <ErrorMessage error={error} />
          <Button type="submit" className="w-full" loading={isLoading}>
            {submitLabel}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-slate-600">
          {footer.text}{' '}
          <Link to={footer.to} className="font-medium text-brand-700 hover:underline">
            {footer.link}
          </Link>
        </p>
        <p className="mt-6 text-center text-xs text-slate-500">{t('auth.reviewPromise', 'Nothing is ever sent or submitted without your approval.')}</p>
      </div>
    </div>
  );
}
