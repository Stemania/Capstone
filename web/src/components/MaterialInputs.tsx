import { useMemo, useState } from 'react';
import { AutoComplete, Input } from 'antd';
import { materialMatches, type MaterialCatalogItem } from '../api/materialCatalog.api';
import { findCatalogItem, useMaterialCatalog } from '../hooks/useMaterialCatalog';

interface MaterialNameInputProps {
  value?: string;
  onChange?: (value: string) => void;
  /** Called when a catalog entry is picked, e.g. to fill its default unit. */
  onPick?: (item: MaterialCatalogItem) => void;
  placeholder?: string;
  disabled?: boolean;
}

/** Free text with catalog suggestions; typing the shop's term ("41-40",
 *  "Iron") finds the entry. */
export function MaterialNameInput({
  value,
  onChange,
  onPick,
  placeholder = 'Material name',
  disabled,
}: MaterialNameInputProps) {
  const catalog = useMaterialCatalog();
  const [query, setQuery] = useState('');

  const options = useMemo(
    () =>
      catalog
        .filter((item) => materialMatches(item, query))
        .slice(0, 12)
        .map((item) => ({
          value: item.name,
          label: (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span>{item.name}</span>
              <span style={{ color: '#64748b', fontSize: 12 }}>
                {[item.shopTerm && `“${item.shopTerm}”`, item.category].filter(Boolean).join(' · ')}
              </span>
            </div>
          ),
        })),
    [catalog, query]
  );

  return (
    <AutoComplete
      value={value}
      options={options}
      disabled={disabled}
      onSearch={setQuery}
      onFocus={() => setQuery(value || '')}
      onChange={(v) => onChange?.(v)}
      onSelect={(v: string) => {
        const item = findCatalogItem(catalog, v);
        if (item) onPick?.(item);
      }}
      popupMatchSelectWidth={false}
      style={{ width: '100%' }}
    >
      <Input placeholder={placeholder} />
    </AutoComplete>
  );
}

interface GradeInputProps {
  value?: string;
  onChange?: (value: string) => void;
  /** Material name on the line; its catalog grades are suggested. */
  materialName?: string | null;
  placeholder?: string;
  disabled?: boolean;
  size?: 'small' | 'middle' | 'large';
}

/** Free-text grade or spec, suggesting the material's catalog grades. */
export function GradeInput({
  value,
  onChange,
  materialName,
  placeholder = 'Grade / spec',
  disabled,
  size,
}: GradeInputProps) {
  const catalog = useMaterialCatalog();
  const grades = findCatalogItem(catalog, materialName)?.grades ?? [];
  const typed = (value || '').trim().toLowerCase();
  const options = grades
    .filter((g) => !typed || g.toLowerCase().includes(typed))
    .map((g) => ({ value: g }));

  return (
    <AutoComplete
      value={value}
      options={options}
      disabled={disabled}
      onChange={(v) => onChange?.(v)}
      popupMatchSelectWidth={false}
      style={{ width: '100%' }}
    >
      <Input placeholder={placeholder} size={size} />
    </AutoComplete>
  );
}
