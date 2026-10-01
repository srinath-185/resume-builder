import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useRegisterMutation } from '@/app/api/auth';
import { AuthForm } from './AuthForm';

export const RegisterSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(120),
  email: z.string().trim().email('Enter a valid email'),
  // bcrypt only uses the first 72 bytes; the server refuses anything longer.
  password: z.string().min(8, 'Use at least 8 characters').max(72, 'Use at most 72 characters'),
});

export default function Register() {
  const { t } = useTranslation();
  return (
    <AuthForm
      title={t('auth.createAccount', 'Create your account')}
      schema={RegisterSchema}
      mutation={useRegisterMutation}
      submitLabel={t('auth.register', 'Create account')}
      fields={[
        { name: 'name', label: t('auth.name', 'Name'), autoComplete: 'name' },
        { name: 'email', label: t('auth.email', 'Email'), type: 'email', autoComplete: 'email' },
        { name: 'password', label: t('auth.password', 'Password'), type: 'password', autoComplete: 'new-password' },
      ]}
      footer={{ text: t('auth.haveAccount', 'Already have an account?'), link: t('auth.signIn', 'Sign in'), to: '/login' }}
    />
  );
}
