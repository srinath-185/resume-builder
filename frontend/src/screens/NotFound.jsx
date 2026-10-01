import { Link } from 'react-router-dom';
import { EmptyState } from '@/common/components/ui';

export default function NotFound() {
  return (
    <EmptyState title="Page not found">
      <Link to="/" className="font-medium text-brand-700 hover:underline">
        Back to the dashboard
      </Link>
    </EmptyState>
  );
}
