import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Col, InputNumber, Modal, QRCode, Row, Segmented } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
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

  const previewScale = 0.42;

  return (
    <>
      <Modal
        open={open}
        title={title}
        onCancel={onClose}
        width={640}
        centered
        destroyOnHidden
        footer={[
          <Button key="cancel" onClick={onClose}>
            Close
          </Button>,
          <Button
            key="print"
            type="primary"
            icon={<PrinterOutlined />}
            disabled={!items.length}
            loading={printing}
            onClick={print}
          >
            Print {labelCount} label{labelCount === 1 ? '' : 's'}
          </Button>,
        ]}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Label size</div>
            <Segmented
              block
              value={sizeId}
              onChange={(v) => setSizeId(v as LabelSizeId)}
              options={Object.values(LABEL_SIZES).map((s) => ({ value: s.id, label: s.label }))}
            />
            <div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>{size.hint}</div>
          </div>
          <Row gutter={12}>
            <Col span={12}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Copies of each</div>
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
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Start at label</div>
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
          <div style={{ color: '#64748b', fontSize: 12, marginTop: -8 }}>
            Start at a later label to use the rest of a sheet that was partly used. Labels are
            counted left to right, top to bottom.
          </div>
          <Checkbox checked={cutLines} onChange={(e) => setCutLines(e.target.checked)}>
            Show cut lines (for plain paper)
          </Checkbox>
          <Alert
            type="info"
            showIcon
            message={`${labelCount} label${labelCount === 1 ? '' : 's'} on ${sheets.length} A4 sheet${
              sheets.length === 1 ? '' : 's'
            }. In the print dialog, set the scale to 100% (Actual size) and turn off headers and footers.`}
          />
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
        </div>
      </Modal>
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
