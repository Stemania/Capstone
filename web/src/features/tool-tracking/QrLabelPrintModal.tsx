import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Col, InputNumber, QRCode, Row, Select, Tooltip } from 'antd';
import { InfoCircleOutlined, PrinterOutlined, QrcodeOutlined } from '@ant-design/icons';
import { FormModal } from '../../components/ui';
import {
  LABEL_SIZES,
  layoutSheets,
  perSheet,
  type LabelSize,
  type LabelSizeId,
  type QrLabelItem,
} from './qrLabels';
import './qrLabels.css';
import labelCss from './qrLabels.css?raw';

const PAD = 1.6; // mm, inside each label
const LARGE_TEXT = 20; // mm under the QR on large labels

function qrSide(size: LabelSize) {
  return size.id === 'large' ? size.height - PAD * 2 - LARGE_TEXT : size.height - PAD * 2;
}

function Sheet({ cells, size, cutLines }: { cells: (QrLabelItem | null)[]; size: LabelSize; cutLines: boolean }) {
  const side = qrSide(size);
  return (
    <div className="qr-sheet">
      {cells.map((item, i) => {
        if (!item) return null;
        const col = i % size.cols;
        const row = Math.floor(i / size.cols);
        return (
          <div
            key={`${item.key}-${i}`}
            className={`qr-label qr-label--${size.id}${cutLines ? ' qr-label--cut' : ''}`}
            style={{
              left: `${size.left + col * (size.width + size.colGap)}mm`,
              top: `${size.top + row * (size.height + size.rowGap)}mm`,
              width: `${size.width}mm`,
              height: `${size.height}mm`,
            }}
          >
            <div className="qr-label__qr" style={{ width: `${side}mm`, height: `${side}mm` }}>
              <QRCode value={item.code} type="svg" size={256} bordered={false} errorLevel="M" />
            </div>
            <div className="qr-label__text">
              <span className="qr-label__code">{item.code}</span>
              <span className="qr-label__name">{item.name}</span>
              {item.detail ? <span className="qr-label__detail">{item.detail}</span> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Print QR labels for the chosen items on A4 label sheets (or plain A4 paper). */
export default function QrLabelPrintModal({
  open,
  items,
  onClose,
  title = 'Print QR labels',
}: {
  open: boolean;
  items: QrLabelItem[];
  onClose: () => void;
  title?: string;
}) {
  const [sizeId, setSizeId] = useState<LabelSizeId>('medium');
  const [copies, setCopies] = useState(1);
  const [startAt, setStartAt] = useState(1);
  const [cutLines, setCutLines] = useState(false);
  const [printing, setPrinting] = useState(false);

  const size = LABEL_SIZES[sizeId];
  const per = perSheet(size);
  const sheets = useMemo(
    () => layoutSheets(items, size, copies, startAt),
    [items, size, copies, startAt]
  );
  const labelCount = items.length * Math.max(1, copies);

  useEffect(() => {
    if (startAt > per) setStartAt(1);
  }, [per, startAt]);

  const printRef = useRef<HTMLDivElement>(null);

  /** Print from a separate, hidden frame holding only the sheets, so the page
   * layout (and its own print styles) cannot change what comes out. */
  const print = () => {
    const html = printRef.current?.innerHTML;
    if (!html) return;
    setPrinting(true);
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) {
      frame.remove();
      setPrinting(false);
      return;
    }
    doc.open();
    doc.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>QR labels</title><style>` +
        `@page { size: A4 portrait; margin: 0; } html, body { margin: 0; padding: 0; background: #fff; }` +
        labelCss +
        `</style></head><body>${html}</body></html>`
    );
    doc.close();
    const cleanup = () => {
      setPrinting(false);
      setTimeout(() => frame.remove(), 500);
    };
    win.addEventListener('afterprint', cleanup, { once: true });
    setTimeout(() => {
      win.focus();
      win.print();
      // Some browsers do not send afterprint from a frame.
      setTimeout(cleanup, 1500);
    }, 150);
  };

  const previewScale = 0.4;
  const field = (text: string) => <div className="qr-form__label">{text}</div>;

  return (
    <>
      <FormModal
        open={open}
        icon={<QrcodeOutlined />}
        title={title}
        width={820}
        onCancel={onClose}
        destroyOnHidden
        footer={
          <>
            <Button onClick={onClose} style={{ minWidth: 96 }}>
              Close
            </Button>
            <Button
              type="primary"
              icon={<PrinterOutlined />}
              disabled={!items.length}
              loading={printing}
              onClick={print}
              style={{ fontWeight: 700 }}
            >
              Print {labelCount} label{labelCount === 1 ? '' : 's'}
            </Button>
          </>
        }
      >
        <Row gutter={[24, 16]} className="qr-form">
          <Col xs={24} md={11}>
            {field('Label size')}
            <Select
              value={sizeId}
              onChange={(v) => setSizeId(v as LabelSizeId)}
              style={{ width: '100%' }}
              options={Object.values(LABEL_SIZES).map((s) => ({ value: s.id, label: s.label, hint: s.hint }))}
              optionRender={(o) => (
                <div>
                  <div style={{ fontWeight: 600 }}>{o.label}</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>{o.data.hint}</div>
                </div>
              )}
            />
            <div className="qr-form__hint">{size.hint}</div>

            <Row gutter={12} style={{ marginTop: 14 }}>
              <Col span={12}>
                {field('Copies of each')}
                <InputNumber
                  min={1}
                  max={50}
                  precision={0}
                  value={copies}
                  onChange={(v) => setCopies(Math.max(1, Number(v) || 1))}
                  style={{ width: '100%' }}
                />
              </Col>
              <Col span={12}>
                <div className="qr-form__label">
                  Start at label{' '}
                  <Tooltip title="To reuse a partly used sheet. Counted left to right, top to bottom.">
                    <InfoCircleOutlined style={{ color: '#94a3b8', fontSize: 12 }} />
                  </Tooltip>
                </div>
                <InputNumber
                  min={1}
                  max={per}
                  precision={0}
                  value={startAt}
                  onChange={(v) => setStartAt(Math.min(per, Math.max(1, Number(v) || 1)))}
                  style={{ width: '100%' }}
                />
              </Col>
            </Row>

            <Checkbox checked={cutLines} onChange={(e) => setCutLines(e.target.checked)} style={{ marginTop: 14 }}>
              Cut lines (plain paper)
            </Checkbox>

            <div className="qr-form__summary">
              {labelCount} label{labelCount === 1 ? '' : 's'} · {sheets.length} A4 sheet
              {sheets.length === 1 ? '' : 's'}
              <div className="qr-form__hint">Print at 100% scale with headers and footers off.</div>
            </div>
          </Col>
          <Col xs={24} md={13}>
            {sheets[0] ? (
              <div className="qr-preview" aria-label="Preview of the first sheet">
                <div
                  className="qr-preview__frame"
                  style={{ width: `calc(210mm * ${previewScale})`, height: `calc(297mm * ${previewScale})` }}
                >
                  <div style={{ transform: `scale(${previewScale})`, transformOrigin: 'top left' }}>
                    {/* The preview always outlines labels so their places are visible. */}
                    <Sheet cells={sheets[0]} size={size} cutLines />
                  </div>
                </div>
              </div>
            ) : null}
          </Col>
        </Row>
      </FormModal>
      {open ? (
        <div ref={printRef} style={{ display: 'none' }} aria-hidden>
          {sheets.map((cells, i) => (
            <Sheet key={i} cells={cells} size={size} cutLines={cutLines} />
          ))}
        </div>
      ) : null}
    </>
  );
}
