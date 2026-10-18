import { useMemo, useState } from 'react';
import { AutoComplete, Button, Input, Select } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { materialMatches, type MaterialCatalogItem } from '../api/materialCatalog.api';
import { findCatalogItem, useMaterialCatalog } from '../hooks/useMaterialCatalog';
import { materialLineLocked } from './materialPicker';

export { formatPoMaterialLabel, materialLineLocked } from './materialPicker';

interface MaterialCatalogPickerProps {
  catalogId?: string | null;
  materialName?: string;
  onPick: (item: MaterialCatalogItem) => void;
  onClear: () => void;
  placeholder?: string;
  disabled?: boolean;
  size?: 'small' | 'middle' | 'large';
}

/** Searchable picker over offered catalog materials. Once picked, the name is
 *  read-only with a clear control to re-pick — no free typing of names. */
export function MaterialCatalogPicker({
  catalogId,
  materialName,
  onPick,
  onClear,
  placeholder = 'Pick a material',
  disabled,
  size = 'small',
}: MaterialCatalogPickerProps) {
  const catalog = useMaterialCatalog();
  const locked = materialLineLocked(catalogId);

  const options = useMemo(
    () =>
      catalog.map((item) => ({
        value: item.id,
        label: item.name,
        search: `${item.name} ${item.shopTerm || ''} ${item.category || ''}`.toLowerCase(),
      })),
    [catalog]
  );

  if (locked) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Input
          size={size}
          value={materialName || ''}
          readOnly
          disabled={disabled}
          style={{ flex: 1, fontWeight: 600 }}
        />
        {!disabled ? (
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            aria-label="Clear material"
            onClick={onClear}
          />
        ) : null}
      </div>
    );
  }

  return (
    <Select
      showSearch
      allowClear
      size={size}
      disabled={disabled}
      placeholder={placeholder}
      style={{ width: '100%' }}
      options={options}
      optionFilterProp="search"
      filterOption={(input, option) =>
        String(option?.search || '').includes(input.trim().toLowerCase())
      }
      onChange={(id: string) => {
        const item = catalog.find((c) => c.id === id);
        if (item) onPick(item);
      }}
    />
  );
}

interface MaterialNameInputProps {
  value?: string;
  onChange?: (value: string) => void;
  onPick?: (item: MaterialCatalogItem) => void;
  placeholder?: string;
  disabled?: boolean;
}

/** @deprecated Prefer MaterialCatalogPicker — free text is no longer used on POs. */
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

interface GradeSelectProps {
  value?: string;
  onChange?: (value: string) => void;
  /** Grades from the picked catalog material. */
  grades?: string[];
  /** Material name fallback when grades are not passed. */
  materialName?: string | null;
  placeholder?: string;
  disabled?: boolean;
  size?: 'small' | 'middle' | 'large';
}

/** Dropdown of the material's grades; clear / empty means "—". */
export function GradeSelect({
  value,
  onChange,
  grades: gradesProp,
  materialName,
  placeholder = '—',
  disabled,
  size,
}: GradeSelectProps) {
  const catalog = useMaterialCatalog();
  const grades = gradesProp ?? findCatalogItem(catalog, materialName)?.grades ?? [];

  return (
    <Select
      allowClear
      size={size}
      disabled={disabled || grades.length === 0}
      placeholder={placeholder}
      value={value || undefined}
      onChange={(v) => onChange?.(v || '')}
      style={{ width: '100%' }}
      options={grades.map((g) => ({ value: g, label: g }))}
    />
  );
}

interface GradeInputProps {
  value?: string;
  onChange?: (value: string) => void;
  materialName?: string | null;
  placeholder?: string;
  disabled?: boolean;
  size?: 'small' | 'middle' | 'large';
}

/** Free-text grade with catalog suggestions (draft line edit on existing POs). */
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
