import clsx from 'clsx';
import { EmptyState } from './ui';

/**
 * columns: [{ key, header, render?(row), className? }]
 * Keeps tables horizontally scrollable on narrow screens.
 */
export function DataTable({ columns, rows, rowKey = row => row.id, empty, onRowClick }) {
  if (!rows || rows.length === 0) return <EmptyState title={empty ?? 'Nothing here yet'} />;
  return (
    <div className="overflow-x-auto rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {columns.map(column => (
              <th key={column.key} scope="col" className={clsx('px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500', column.className)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map(row => (
            <tr key={rowKey(row)} onClick={onRowClick ? () => onRowClick(row) : undefined} className={clsx(onRowClick && 'cursor-pointer hover:bg-slate-50')}>
              {columns.map(column => (
                <td key={column.key} className={clsx('px-3 py-2 align-top text-slate-700', column.className)}>
                  {column.render ? column.render(row) : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
