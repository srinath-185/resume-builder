import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useLoginMutation } from '@/app/api/auth';
import { AuthForm } from './AuthForm';

export const LoginSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
});

export default function Login() {
  const { t } = useTranslation();
  return (
    <AuthForm
      title={t('auth.signIn', 'Sign in')}
      schema={LoginSchema}
      mutation={useLoginMutation}
      submitLabel={t('auth.signIn', 'Sign in')}
      fields={[
        { name: 'email', label: t('auth.email', 'Email'), type: 'email', autoComplete: 'email' },
        { name: 'password', label: t('auth.password', 'Password'), type: 'password', autoComplete: 'current-password' },
      ]}
      footer={{ text: t('auth.noAccount', 'No account yet?'), link: t('auth.createAccount', 'Create one'), to: '/register' }}
    />
  );
}
