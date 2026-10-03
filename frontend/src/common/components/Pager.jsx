import { useTranslation } from 'react-i18next';
import { Button } from '@/common/components/ui';

export function Pager({ page, total, pageSize, onChange }) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="flex items-center justify-end gap-2 text-sm">
      <Button variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        {t('common.previous', 'Previous')}
      </Button>
      <span>
        {page} / {pages}
      </span>
      <Button variant="secondary" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        {t('common.next', 'Next')}
      </Button>
    </div>
  );
}
