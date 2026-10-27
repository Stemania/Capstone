import { Button, Input, InputNumber, Select, Tooltip } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { MATERIAL_UNITS } from '../../api/materialCatalog.api';
import { GradeSelect, MaterialCatalogPicker } from '../../components/MaterialInputs';
import { useMaterialCatalog } from '../../hooks/useMaterialCatalog';
import { blankPlannedRow, type PlannedRow } from './plannedMaterials';

/**
 * "Materials needed" rows on the job order form: catalog material, grade,
 * size or spec, quantity and unit. Ordering later starts from this list.
 */
export default function PlannedMaterialsEditor({
  rows,
  onChange,
  errorKey,
}: {
  rows: PlannedRow[];
  onChange: (rows: PlannedRow[]) => void;
  /** Row to mark after a failed save. */
  errorKey?: number | null;
}) {
  const catalog = useMaterialCatalog();
  const set = (key: number, patch: Partial<PlannedRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: number) => onChange(rows.filter((r) => r.key !== key));
  const add = () => onChange([...rows, blankPlannedRow()]);

  return (
    <div className="jo-mats">
      {rows.length ? (
        <div className="jo-mats__grid" role="table" aria-label="Materials needed">
          <div className="jo-mats__row jo-mats__row--head" role="row">
            <span role="columnheader" className="jo-mats__h jo-mats__h--material">Material</span>
            <span role="columnheader" className="jo-mats__h jo-mats__h--grade">Grade</span>
            <span role="columnheader" className="jo-mats__h jo-mats__h--size">Size / spec</span>
            <span role="columnheader" className="jo-mats__h jo-mats__h--qty">Qty</span>
            <span role="columnheader" className="jo-mats__h jo-mats__h--unit">Unit</span>
            <span aria-hidden className="jo-mats__h jo-mats__h--remove" />
          </div>
          <div className="jo-mats__rows">
          {rows.map((r) => {
            const ordered = r.onOrder > 0;
            const grades = catalog.find((c) => c.id === r.materialCatalogId)?.grades;
            const invalid = errorKey === r.key;
            return (
              <div key={r.key} className={`jo-mats__row${invalid ? ' is-invalid' : ''}`} role="row">
                <div className="jo-mats__cell jo-mats__cell--material" data-label="Material">
                  <MaterialCatalogPicker
                    size="middle"
                    catalogId={r.materialCatalogId}
                    materialName={r.materialName}
                    disabled={ordered}
                    onPick={(item) =>
                      set(r.key, {
                        materialCatalogId: item.id,
                        materialName: item.name,
                        gradeOrSpec: '',
                        unit: item.defaultUnit || r.unit,
                      })
                    }
                    onClear={() =>
                      set(r.key, { materialCatalogId: null, materialName: '', gradeOrSpec: '' })
                    }
                  />
                </div>
                <div className="jo-mats__cell jo-mats__cell--grade" data-label="Grade">
                  <GradeSelect
                    size="middle"
                    grades={grades}
                    placeholder="Grade"
                    materialName={r.materialName}
                    value={r.gradeOrSpec}
                    disabled={!r.materialCatalogId}
                    onChange={(v) => set(r.key, { gradeOrSpec: v })}
                  />
                </div>
                <div className="jo-mats__cell jo-mats__cell--size" data-label="Size / spec">
                  <Input
                    placeholder="Size / spec, e.g. Ø50 × 200 mm"
                    value={r.sizeSpec}
                    disabled={!r.materialCatalogId}
                    maxLength={255}
                    onChange={(e) => set(r.key, { sizeSpec: e.target.value })}
                  />
                </div>
                <div className="jo-mats__cell jo-mats__cell--qty" data-label="Qty">
                  <Tooltip title={ordered ? `${r.onOrder} ${r.unit} already on order` : undefined}>
                    <InputNumber
                      min={ordered ? r.onOrder : 0.01}
                      step={1}
                      style={{ width: '100%' }}
                      value={r.quantity}
                      status={invalid && !(r.quantity && r.quantity > 0) ? 'error' : undefined}
                      onChange={(v) => set(r.key, { quantity: v })}
                    />
                  </Tooltip>
                </div>
                <div className="jo-mats__cell jo-mats__cell--unit" data-label="Unit">
                  <Select
                    style={{ width: '100%' }}
                    value={r.unit}
                    disabled={!r.materialCatalogId || ordered}
                    onChange={(v: string) => set(r.key, { unit: v })}
                    options={MATERIAL_UNITS.map((u) => ({ value: u, label: u }))}
                  />
                </div>
                <div className="jo-mats__cell jo-mats__cell--remove">
                  <Tooltip title={ordered ? 'Already on a supplier order' : 'Remove'}>
                    <Button
                      type="text"
                      icon={<DeleteOutlined />}
                      aria-label="Remove material"
                      disabled={ordered}
                      onClick={() => remove(r.key)}
                    />
                  </Tooltip>
                </div>
              </div>
            );
          })}
          </div>
        </div>
      ) : (
        <div className="jo-mats__empty">
          No materials listed yet. Add them now, or later before the job is released.
        </div>
      )}
      <Button className="jo-mats__add" icon={<PlusOutlined />} onClick={add}>
        Add material
      </Button>
    </div>
  );
}
